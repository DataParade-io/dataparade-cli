import { execFileSync } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import { compareScans, summarizeChangeSet, type ChangeSet } from "@dataparade/kb-compare";

/**
 * `dataparade diff <repo> <base> <head>` (DATAP-852): scans two Git revisions of one repository
 * and writes the change set between them. AI is off and nothing is uploaded.
 *
 * - Refuses a working tree with changes that are not committed.
 * - Exports each revision with `git archive` into a temporary folder named after the repository,
 *   so the user's checkout is never touched.
 * - Scans both revisions with the head's `dataparade.config.json`.
 * - Reuses a cached scan only when it was made from the same commit and configuration by the same
 *   CLI, scanner and pattern catalog (DATAP-878); the cached scan's own stamps are checked too.
 * - Writes `change-set.json`, `summary.txt` and `renames.json` (rename map and root commit).
 * - With `keepScans` (`--upload`, DATAP-886), keeps each revision's whole scan output in
 *   `base/` and `head/`, with the commit, root commit and a clean tree in its facts.json stamps:
 *   the scan ran on a `git archive` export, which has no .git to read them from.
 */

export class DiffError extends Error {
  constructor(
    readonly code: "NOT_A_REPO" | "DIRTY_TREE" | "UNKNOWN_REVISION" | "SCAN_FAILED",
    message: string,
  ) {
    super(message);
  }
}

export const CONFIG_FILE = "dataparade.config.json";

export interface Rename {
  from: string;
  to: string;
  similarity: number;
}

/** Scans `dir`, writes the scan output (dataflow.json, facts.json, ...) into `outDir`, and returns its facts.json, parsed. */
export type ScanFn = (dir: string, outDir: string) => unknown;

/** The scan stamps that describe the tools (DATAP-876). */
export interface ToolStamps {
  cliVersion: string;
  scannerCommit: string;
  catalogHash: string;
}

/** True when a scan's stamps say it was made by these tools. Scans without stamps never match. */
export function madeBy(facts: unknown, tools: ToolStamps): boolean {
  const stamps = (facts as { scan?: { stamps?: Partial<ToolStamps> } } | null)?.scan?.stamps;
  return Boolean(stamps) && stamps!.cliVersion === tools.cliVersion && stamps!.scannerCommit === tools.scannerCommit && stamps!.catalogHash === tools.catalogHash;
}

export interface RunDiffOptions {
  repo: string;
  base: string;
  head: string;
  /** Folder for change-set.json, summary.txt and renames.json. Created if missing. */
  outputDir: string;
  scan: ScanFn;
  /** The tools that make the scans: part of the cache key, and checked against a cached scan's stamps. */
  tools: ToolStamps;
  /** Scan cache folder; scans are not cached when null. */
  cacheDir: string | null;
  /** Keep each revision's whole scan output in `<outputDir>/base` and `<outputDir>/head`, for upload. */
  keepScans?: boolean;
  log?: (line: string) => void;
}

export interface RunDiffResult {
  changeSet: ChangeSet;
  summary: string;
  baseSha: string;
  headSha: string;
  rootCommit: string;
  renames: Rename[];
  files: { changeSet: string; summary: string; renames: string };
  /** The kept scan output folders, with `keepScans`. */
  scanDirs?: { base: string; head: string };
}

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

function repoRoot(repo: string): string {
  try {
    return git(repo, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    throw new DiffError("NOT_A_REPO", `${repo} is not inside a Git repository.`);
  }
}

function resolveCommit(repo: string, revision: string): string {
  try {
    return git(repo, ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`]).trim();
  } catch {
    throw new DiffError("UNKNOWN_REVISION", `'${revision}' is not a commit in ${repo}.`);
  }
}

/** The repository's root commit (the oldest one when there are several). */
export function rootCommit(repo: string, sha: string): string {
  const roots = git(repo, ["rev-list", "--max-parents=0", sha]).trim().split("\n").filter(Boolean);
  return roots[roots.length - 1];
}

/** Renamed files between two commits, from `git diff -M`. */
export function renameMap(repo: string, base: string, head: string): Rename[] {
  const out = git(repo, ["diff", "-M", "--name-status", "-z", base, head]);
  const fields = out.split("\0");
  const renames: Rename[] = [];
  for (let i = 0; i < fields.length; ) {
    const status = fields[i];
    if (!status) break;
    if (status.startsWith("R")) {
      renames.push({ from: fields[i + 1], to: fields[i + 2], similarity: Number(status.slice(1)) || 0 });
      i += 3;
    } else if (status.startsWith("C")) {
      i += 3;
    } else {
      i += 2;
    }
  }
  return renames.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

function configAt(repo: string, sha: string): string | null {
  try {
    return git(repo, ["show", `${sha}:${CONFIG_FILE}`]);
  } catch {
    return null;
  }
}

/** Writes the tree of `sha` into `dir`, with the head's configuration in place of its own. */
function exportRevision(repo: string, sha: string, dir: string, headConfig: string | null): void {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("sh", ["-c", 'git -C "$1" archive --format=tar "$2" | tar -x -C "$3"', "sh", repo, sha, dir], { stdio: ["ignore", "ignore", "pipe"] });
  const configPath = path.join(dir, CONFIG_FILE);
  if (headConfig === null) fs.rmSync(configPath, { force: true });
  else fs.writeFileSync(configPath, headConfig);
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Writes the Git stamps of an exported revision into a kept scan's facts.json: the export has no
 * .git, so the scan recorded no commit. The export is exactly that commit, so the tree is clean.
 */
export function stampCommit(factsPath: string, commitSha: string, rootCommitSha: string): void {
  const facts = JSON.parse(fs.readFileSync(factsPath, "utf8")) as { scan?: { stamps?: Record<string, unknown> } };
  const stamps = facts.scan?.stamps;
  if (!stamps) return;
  facts.scan!.stamps = { ...stamps, commitSha, dirty: false, rootCommitSha };
  fs.writeFileSync(factsPath, `${JSON.stringify(facts, null, 2)}\n`);
}

export function defaultCacheDir(): string {
  return process.env.DATAPARADE_CACHE_DIR?.trim() || path.join(os.homedir(), ".cache", "dataparade", "diff-scans");
}

export function runDiff(options: RunDiffOptions): RunDiffResult {
  const log = options.log ?? (() => {});
  const repo = repoRoot(path.resolve(options.repo));
  if (git(repo, ["status", "--porcelain"]).trim() !== "") {
    throw new DiffError("DIRTY_TREE", `${repo} has changes that are not committed. Commit or stash them, then run diff again.`);
  }
  const baseSha = resolveCommit(repo, options.base);
  const headSha = resolveCommit(repo, options.head);
  const root = rootCommit(repo, headSha);
  const headConfig = configAt(repo, headSha);
  const configChanged = configAt(repo, baseSha) !== headConfig;
  const toolsKey = sha256(JSON.stringify([options.tools.cliVersion, options.tools.scannerCommit, options.tools.catalogHash, headConfig ?? ""])).slice(0, 16);
  const cacheKey = (sha: string) => `${sha}-${toolsKey}`;
  const folderName = path.basename(repo);

  const keepDir = (side: "base" | "head") => path.join(options.outputDir, side);

  /** The scan of `sha`; with `keepScans`, its whole output is also left in `keep`. */
  const scanRevision = (sha: string, keep: string | null): unknown => {
    const cacheFolder = options.cacheDir ? path.join(options.cacheDir, root, cacheKey(sha)) : null;
    const cached = cacheFolder ? path.join(cacheFolder, "facts.json") : null;
    // A cache entry from before --upload holds facts.json only; an upload needs the whole output.
    const usable = cached && fs.existsSync(cached) && (!keep || fs.existsSync(path.join(cacheFolder!, "dataflow.json")));
    if (usable) {
      const facts: unknown = JSON.parse(fs.readFileSync(cached, "utf8"));
      if (madeBy(facts, options.tools)) {
        log(`Reusing the scan of ${sha.slice(0, 8)}.`);
        if (keep) fs.cpSync(cacheFolder!, keep, { recursive: true });
        return facts;
      }
      log(`The cached scan of ${sha.slice(0, 8)} was made by other tools; scanning again.`);
    }
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "dataparade-diff-"));
    try {
      const dir = path.join(work, folderName);
      const out = keep ?? path.join(work, "out");
      exportRevision(repo, sha, dir, headConfig);
      fs.mkdirSync(out, { recursive: true });
      log(`Scanning ${sha.slice(0, 8)}...`);
      const facts = options.scan(dir, out);
      if (cacheFolder) {
        fs.rmSync(cacheFolder, { recursive: true, force: true });
        fs.mkdirSync(cacheFolder, { recursive: true });
        fs.cpSync(out, cacheFolder, { recursive: true });
        fs.writeFileSync(cached!, JSON.stringify(facts));
      }
      return facts;
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  };

  if (options.keepScans) {
    for (const side of ["base", "head"] as const) fs.rmSync(keepDir(side), { recursive: true, force: true });
  }
  const baseFacts = scanRevision(baseSha, options.keepScans ? keepDir("base") : null);
  const headFacts = headSha === baseSha ? baseFacts : scanRevision(headSha, options.keepScans ? keepDir("head") : null);
  let scanDirs: RunDiffResult["scanDirs"];
  if (options.keepScans) {
    if (headSha === baseSha) fs.cpSync(keepDir("base"), keepDir("head"), { recursive: true });
    scanDirs = { base: keepDir("base"), head: keepDir("head") };
    stampCommit(path.join(scanDirs.base, "facts.json"), baseSha, root);
    stampCommit(path.join(scanDirs.head, "facts.json"), headSha, root);
  }
  // The rename map makes renamed and moved elements "renamed" instead of removed plus added (DATAP-866).
  const renames = renameMap(repo, baseSha, headSha);
  const changeSet = compareScans(baseFacts, headFacts, { configChanged, renames });
  const summary = summarizeChangeSet(changeSet);

  fs.mkdirSync(options.outputDir, { recursive: true });
  const files = {
    changeSet: path.join(options.outputDir, "change-set.json"),
    summary: path.join(options.outputDir, "summary.txt"),
    renames: path.join(options.outputDir, "renames.json"),
  };
  fs.writeFileSync(files.changeSet, `${JSON.stringify(changeSet, null, 2)}\n`);
  fs.writeFileSync(files.summary, `${summary}\n`);
  fs.writeFileSync(files.renames, `${JSON.stringify({ rootCommit: root, base: baseSha, head: headSha, renames }, null, 2)}\n`);
  return { changeSet, summary, baseSha, headSha, rootCommit: root, renames, files, ...(scanDirs ? { scanDirs } : {}) };
}
