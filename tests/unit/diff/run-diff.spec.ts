import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { CONFIG_FILE, DiffError, renameMap, runDiff, type ScanFn } from "../../../src/diff/run-diff";

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function commitAll(repo: string, message: string): string {
  git(repo, "add", "-A");
  git(repo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

const STAMPS = {
  scannerCommit: "f".repeat(40),
  cliVersion: "0",
  catalogHash: "sha256:0123456789abcdef",
  configHash: "sha256:fedcba9876543210",
  aiInference: false,
  structureGraph: true,
  commitSha: null,
  dirty: null,
  rootCommitSha: null,
  scanRoot: null,
};

const TOOLS = { cliVersion: STAMPS.cliVersion, scannerCommit: STAMPS.scannerCommit, catalogHash: STAMPS.catalogHash };

const facts = (components: string[], stamps: Record<string, unknown> = STAMPS) => ({
  schemaVersion: 1,
  scan: { projectName: "p", scannedAt: "t", cliVersion: "0", scannerVersion: "0", stamps },
  components: components.map((name) => ({
    id: `cmp_${name}`,
    identity: { kind: "component", key: `app:root|third_party||${name}.ts|${name}`, parts: {} },
    name,
    type: "third_party",
    subType: "",
    confidence: 0.9,
    sourceLocations: [],
    codeRefs: [],
  })),
  dataFlows: [],
  dataItems: [],
  relations: [],
});

/** A fake scan: one component per `.ts` file at the top of the folder. Records what it saw. */
function fakeScan(seen: Array<{ files: string[]; config: string | null; folder: string }>, stamps: Record<string, unknown> = STAMPS): ScanFn {
  return (dir) => {
    const files = fs.readdirSync(dir).sort();
    const configPath = path.join(dir, CONFIG_FILE);
    seen.push({ files, config: fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : null, folder: path.basename(dir) });
    return facts(files.filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, "")), stamps);
  };
}

describe("runDiff (DATAP-852)", () => {
  let work: string;
  let repo: string;
  let base: string;
  let head: string;

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "run-diff-"));
    repo = path.join(work, "shop");
    fs.mkdirSync(repo);
    git(repo, "init", "-q");
    fs.writeFileSync(path.join(repo, "stripe.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(repo, "auth0.ts"), "export const b = 2;\n");
    fs.writeFileSync(path.join(repo, "mailer.ts"), "export function send() {\n  return 'a fairly long body so git sees a rename';\n}\n");
    fs.writeFileSync(path.join(repo, CONFIG_FILE), '{"projectName":"old"}\n');
    base = commitAll(repo, "base");
    fs.rmSync(path.join(repo, "auth0.ts"));
    fs.renameSync(path.join(repo, "mailer.ts"), path.join(repo, "email.ts"));
    fs.writeFileSync(path.join(repo, CONFIG_FILE), '{"projectName":"new"}\n');
    head = commitAll(repo, "head");
  });
  afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

  const run = (scan: ScanFn, extra: Partial<Parameters<typeof runDiff>[0]> = {}) =>
    runDiff({ repo, base, head, outputDir: path.join(work, "out"), scan, tools: TOOLS, cacheDir: path.join(work, "cache"), ...extra });

  it("scans both revisions with the head's configuration and writes the change set", () => {
    const seen: Array<{ files: string[]; config: string | null; folder: string }> = [];
    const result = run(fakeScan(seen));
    expect(seen.map((s) => s.config)).toEqual(['{"projectName":"new"}\n', '{"projectName":"new"}\n']);
    expect(seen.every((s) => s.folder === "shop")).toBe(true);
    expect(result.changeSet.configChanged).toBe(true);
    expect(result.changeSet.changes.map((c) => [c.change, c.name])).toEqual([
      ["removed", "auth0"],
      ["added", "email"],
      ["removed", "mailer"],
    ]);
    expect(JSON.parse(fs.readFileSync(result.files.changeSet, "utf8"))).toEqual(result.changeSet);
    expect(fs.readFileSync(result.files.summary, "utf8")).toContain("removed: 2 components");
    expect(JSON.parse(fs.readFileSync(result.files.renames, "utf8"))).toMatchObject({
      rootCommit: base,
      base,
      head,
      renames: [{ from: "mailer.ts", to: "email.ts" }],
    });
  });

  it("reuses a cached scan only when the commit, configuration and tools are the same (DATAP-878)", () => {
    const seen: Array<{ files: string[]; config: string | null; folder: string }> = [];
    run(fakeScan(seen));
    run(fakeScan(seen));
    expect(seen).toHaveLength(2);
    for (const change of [{ cliVersion: "9" }, { scannerCommit: "e".repeat(40) }, { catalogHash: "sha256:ffffffffffffffff" }]) {
      const before = seen.length;
      run(fakeScan(seen, { ...STAMPS, ...change }), { tools: { ...TOOLS, ...change } });
      expect(seen).toHaveLength(before + 2);
    }
    run(fakeScan(seen), { cacheDir: null });
    expect(seen.length).toBeGreaterThanOrEqual(10);
  });

  it("scans again when a cached scan's stamps do not match the tools", () => {
    const seen: Array<{ files: string[]; config: string | null; folder: string }> = [];
    run(fakeScan(seen, { ...STAMPS, scannerCommit: "e".repeat(40) }));
    expect(seen).toHaveLength(2);
    run(fakeScan(seen));
    expect(seen).toHaveLength(4);
  });

  it("scans once when base and head are the same commit", () => {
    const seen: Array<{ files: string[]; config: string | null; folder: string }> = [];
    const result = run(fakeScan(seen), { base: head });
    expect(seen).toHaveLength(1);
    expect(result.changeSet.unchanged).toBe(true);
  });

  it("refuses a working tree with changes that are not committed", () => {
    fs.writeFileSync(path.join(repo, "new.ts"), "x\n");
    expect(() => run(fakeScan([]))).toThrow(expect.objectContaining({ code: "DIRTY_TREE" }));
  });

  it("refuses an unknown revision and a folder outside Git", () => {
    expect(() => run(fakeScan([]), { base: "no-such-ref" })).toThrow(expect.objectContaining({ code: "UNKNOWN_REVISION" }));
    expect(() => run(fakeScan([]), { repo: os.tmpdir() })).toThrow(DiffError);
  });

  it("passes on a refusal when the two scans cannot be compared (DATAP-877)", () => {
    let call = 0;
    const scan: ScanFn = () => facts(["stripe"], call++ === 0 ? STAMPS : { ...STAMPS, aiInference: true });
    expect(() => run(scan, { cacheDir: null })).toThrow(expect.objectContaining({ name: "ComparisonRefused", reason: "ai_enriched" }));
  });

  /** A fake scan that also writes its output, as the real `scan -o` does. */
  const writingScan = (seen: Array<{ files: string[]; config: string | null; folder: string }>): ScanFn => {
    const inner = fakeScan(seen);
    return (dir, outDir) => {
      const result = inner(dir, outDir);
      fs.writeFileSync(path.join(outDir, "dataflow.json"), JSON.stringify({ metadata: { projectName: "shop" } }));
      fs.writeFileSync(path.join(outDir, "facts.json"), JSON.stringify(result));
      return result;
    };
  };

  it("keeps both scans with their commit stamps for --upload (DATAP-886)", () => {
    const seen: Array<{ files: string[]; config: string | null; folder: string }> = [];
    const result = run(writingScan(seen), { keepScans: true });
    expect(result.scanDirs).toEqual({ base: path.join(work, "out", "base"), head: path.join(work, "out", "head") });
    for (const [side, sha] of [
      ["base", base],
      ["head", head],
    ] as const) {
      const kept = JSON.parse(fs.readFileSync(path.join(result.scanDirs![side], "facts.json"), "utf8"));
      expect(kept.scan.stamps).toEqual({ ...STAMPS, commitSha: sha, dirty: false, rootCommitSha: base });
      expect(fs.existsSync(path.join(result.scanDirs![side], "dataflow.json"))).toBe(true);
    }
    // Both scans used the head's configuration, so the tool stamps match.
    expect(seen.map((s) => s.config)).toEqual(['{"projectName":"new"}\n', '{"projectName":"new"}\n']);
  });

  it("reuses a cached scan for --upload only when the cache holds the whole output", () => {
    const seen: Array<{ files: string[]; config: string | null; folder: string }> = [];
    run(fakeScan(seen));
    expect(seen).toHaveLength(2);
    // The cache from a plain run has no dataflow.json: scan again.
    run(writingScan(seen), { keepScans: true });
    expect(seen).toHaveLength(4);
    const result = run(writingScan(seen), { keepScans: true });
    expect(seen).toHaveLength(4);
    const kept = JSON.parse(fs.readFileSync(path.join(result.scanDirs!.head, "facts.json"), "utf8"));
    expect(kept.scan.stamps.commitSha).toBe(head);
    // The cache keeps the scan as it was made, without the commit stamps.
    run(writingScan(seen));
    expect(seen).toHaveLength(4);
  });

  it("keeps the same scan as base and head when they are one commit", () => {
    const seen: Array<{ files: string[]; config: string | null; folder: string }> = [];
    const result = run(writingScan(seen), { base: head, keepScans: true });
    expect(seen).toHaveLength(1);
    expect(fs.existsSync(path.join(result.scanDirs!.base, "dataflow.json"))).toBe(true);
    expect(fs.existsSync(path.join(result.scanDirs!.head, "dataflow.json"))).toBe(true);
  });

  it("lists renames from git diff -M", () => {
    expect(renameMap(repo, base, head)).toEqual([expect.objectContaining({ from: "mailer.ts", to: "email.ts" })]);
  });
});
