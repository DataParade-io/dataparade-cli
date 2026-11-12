import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { buildScanStamps, catalogHash, configHash, readGitStamps } from "../../../src/facts/scan-stamps";
import { scanStampsSchema } from "../../../src/facts/schema";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const commit = (cwd: string, message: string) => {
  git(cwd, "add", "-A");
  git(cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "--allow-empty", "-m", message);
};

describe("configHash (DATAP-876)", () => {
  it("does not depend on list order, case of domains, or settings that do not change the output", () => {
    const a = configHash({ excludePaths: ["b/**", "a/**"], organizationDomains: ["Example.com"], minimumConfidence: 0.5 });
    const b = configHash({ excludePaths: ["a/**", "b/**"], organizationDomains: ["example.com"], minimumConfidence: 0.5, ...({ aiModel: "x", projectName: "y" } as object) });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{16}$/);
  });

  it("changes when an output setting changes", () => {
    expect(configHash({ minimumConfidence: 0.5 })).not.toBe(configHash({ minimumConfidence: 0.6 }));
    expect(configHash({ excludePaths: ["a/**"] })).not.toBe(configHash({ excludePaths: [] }));
  });
});

describe("catalogHash", () => {
  it("hashes file paths and contents in sorted order", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-"));
    fs.mkdirSync(path.join(dir, "b"));
    fs.writeFileSync(path.join(dir, "b", "x.yaml"), "x");
    fs.writeFileSync(path.join(dir, "a.yaml"), "a");
    const first = catalogHash(dir);
    expect(catalogHash(dir)).toBe(first);
    fs.writeFileSync(path.join(dir, "a.yaml"), "changed");
    expect(catalogHash(dir)).not.toBe(first);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("readGitStamps", () => {
  let work: string;
  let repo: string;
  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "git-stamps-"));
    repo = path.join(work, "repo");
    fs.mkdirSync(path.join(repo, "services", "api"), { recursive: true });
    git(repo, "init", "-q");
    fs.writeFileSync(path.join(repo, "services", "api", "index.ts"), "export const a = 1;\n");
    commit(repo, "first");
  });
  afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

  it("reads the commit, the root commit and the scan root, and is clean after a commit", () => {
    const stamps = readGitStamps(path.join(repo, "services"), null);
    const head = git(repo, "rev-parse", "HEAD");
    expect(stamps).toEqual({ commitSha: head, dirty: false, rootCommitSha: head, scanRoot: "services" });
  });

  it("is dirty after an edit, but not because of the scan's own output folder", () => {
    fs.mkdirSync(path.join(repo, ".dataparade"));
    fs.writeFileSync(path.join(repo, ".dataparade", "facts.json"), "{}");
    expect(readGitStamps(repo, path.join(repo, ".dataparade")).dirty).toBe(false);
    expect(readGitStamps(repo, path.join(repo, "not-yet-created")).dirty).toBe(true);
    fs.appendFileSync(path.join(repo, "services", "api", "index.ts"), "// edit\n");
    expect(readGitStamps(repo, path.join(repo, ".dataparade")).dirty).toBe(true);
  });

  it("has no root commit in a shallow clone", () => {
    commit(repo, "second");
    const shallow = path.join(work, "shallow");
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${repo}`, shallow]);
    const stamps = readGitStamps(shallow, null);
    expect(stamps.rootCommitSha).toBeNull();
    expect(stamps.commitSha).toBe(git(repo, "rev-parse", "HEAD"));
  });

  it("uses the --git-context commit for a folder outside Git, and nulls otherwise", () => {
    const plain = path.join(work, "plain");
    fs.mkdirSync(plain);
    const sha = "a".repeat(40);
    expect(readGitStamps(plain, null, sha)).toEqual({ commitSha: sha, dirty: false, rootCommitSha: null, scanRoot: null });
    expect(readGitStamps(plain, null)).toEqual({ commitSha: null, dirty: null, rootCommitSha: null, scanRoot: null });
  });
});

describe("buildScanStamps", () => {
  it("matches the schema", () => {
    const stamps = buildScanStamps({
      cliVersion: "0.0.32",
      scanner: { scannerCommit: "f".repeat(40), catalogHash: "sha256:0123456789abcdef" },
      config: { minimumConfidence: 0.5 },
      aiInference: false,
      structureGraph: true,
      git: { commitSha: null, dirty: null, rootCommitSha: null, scanRoot: null },
    });
    expect(scanStampsSchema.parse(stamps)).toEqual(stamps);
  });
});
