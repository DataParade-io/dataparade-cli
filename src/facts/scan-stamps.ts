import { execFileSync } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

import type { ScanStamps } from "./schema";

/**
 * Scan stamps (DATAP-876): what a comparison needs to know to decide whether two scans can be
 * compared. Two scans of the same commit with the same CLI, scanner, catalog and configuration
 * have equal stamps.
 */

function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

/** JSON with sorted keys, so equal settings always hash the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The settings that change the scan output. AI, upload and display settings are not here. */
export interface OutputSettings {
  organizationDomains?: string[];
  excludePaths?: string[];
  enableAPIDetection?: boolean;
  enableDatabaseDetection?: boolean;
  enableDataFlowDetection?: boolean;
  languages?: string[];
  minimumConfidence?: number;
  deepAnalysis?: boolean;
  terraformJsonPath?: string;
  terraformPlanPath?: string;
  terraformStackSectionPathDepth?: number;
  autoInferTerraformStackSectionPathDepth?: boolean;
  monorepoPackageSectionPathDepth?: number;
  autoInferMonorepoPackageSectionPathDepth?: boolean;
}

export function configHash(config: OutputSettings): string {
  const sorted = (list?: string[]) => (list ? [...list].sort() : undefined);
  return `sha256:${sha256(
    canonical({
      organizationDomains: sorted(config.organizationDomains?.map((d) => d.trim().toLowerCase())),
      excludePaths: sorted(config.excludePaths),
      enableAPIDetection: config.enableAPIDetection,
      enableDatabaseDetection: config.enableDatabaseDetection,
      enableDataFlowDetection: config.enableDataFlowDetection,
      languages: sorted(config.languages),
      minimumConfidence: config.minimumConfidence,
      deepAnalysis: config.deepAnalysis,
      terraformJsonPath: config.terraformJsonPath,
      terraformPlanPath: config.terraformPlanPath,
      terraformStackSectionPathDepth: config.terraformStackSectionPathDepth,
      autoInferTerraformStackSectionPathDepth: config.autoInferTerraformStackSectionPathDepth,
      monorepoPackageSectionPathDepth: config.monorepoPackageSectionPathDepth,
      autoInferMonorepoPackageSectionPathDepth: config.autoInferMonorepoPackageSectionPathDepth,
    }),
  ).slice(0, 16)}`;
}

/** Hash of every file under `patterns/`, by sorted relative path and content. */
export function catalogHash(patternsDir: string): string {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(patternsDir);
  const hash = createHash("sha256");
  for (const file of files.map((f) => path.relative(patternsDir, f).split(path.sep).join("/")).sort()) {
    hash.update(`${file}\0`);
    hash.update(fs.readFileSync(path.join(patternsDir, file)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex").slice(0, 16)}`;
}

/**
 * The bundled scanner (dist/vendor/scanner, written by scripts/vendor-scanner.mjs) records its
 * commit and catalog hash. Running from source (tests), the installed scanner package is used.
 */
export function scannerBuildInfo(cliPackageRoot: string, pinnedCommit: string): { scannerCommit: string; catalogHash: string } {
  // The build copies package.json into dist/, so the root found from dist/src may be dist/ itself.
  for (const vendored of [path.join(cliPackageRoot, "dist", "vendor", "scanner"), path.join(cliPackageRoot, "vendor", "scanner")]) {
    const manifest = path.join(vendored, "package.json");
    if (!fs.existsSync(manifest)) continue;
    const info = JSON.parse(fs.readFileSync(manifest, "utf8")) as { gitHead?: string; catalogHash?: string };
    if (info.gitHead && info.catalogHash) return { scannerCommit: info.gitHead, catalogHash: info.catalogHash };
  }
  const installed = path.join(cliPackageRoot, "node_modules", "@dataparade", "scanner", "patterns");
  return { scannerCommit: pinnedCommit, catalogHash: fs.existsSync(installed) ? catalogHash(installed) : "unknown" };
}

/** The @dataparade/cli package root, from a file inside it (src/ when run from source, dist/src/ when built). */
export function findCliPackageRoot(start: string): string {
  let dir = start;
  for (;;) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest)) {
      try {
        if ((JSON.parse(fs.readFileSync(manifest, "utf8")) as { name?: string }).name === "@dataparade/cli") return dir;
      } catch {
        // keep looking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/** realpath of a path that may not exist yet: the nearest existing ancestor, resolved, plus the rest. */
function realpathOfNearest(target: string): string {
  let dir = path.resolve(target);
  const rest: string[] = [];
  while (!fs.existsSync(dir)) {
    rest.unshift(path.basename(dir));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(fs.realpathSync(dir), ...rest);
}

export interface GitStamps {
  commitSha: string | null;
  dirty: boolean | null;
  rootCommitSha: string | null;
  scanRoot: string | null;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/**
 * Git facts for the scanned folder, read before the scan writes anything. `outputDir` is left
 * out of the dirty check, so the scan's own output never makes a checkout dirty. In a shallow
 * clone the root commit is unknown (null); the repository is then matched by its remote URL.
 * `fallbackCommitSha` comes from --git-context, for scans of archives that have no .git.
 */
export function readGitStamps(scanRoot: string, outputDir: string | null, fallbackCommitSha?: string): GitStamps {
  try {
    const top = git(scanRoot, ["rev-parse", "--show-toplevel"]);
    const commitSha = git(top, ["rev-parse", "HEAD"]);
    const realTop = fs.realpathSync(top);
    const realOutput = outputDir ? realpathOfNearest(outputDir) : null;
    const exclude = realOutput && realOutput.startsWith(`${realTop}${path.sep}`)
      ? [`:(exclude)${path.relative(realTop, realOutput).split(path.sep).join("/")}`]
      : [];
    const dirty = git(top, ["status", "--porcelain", "--", ".", ...exclude]) !== "";
    const shallow = git(top, ["rev-parse", "--is-shallow-repository"]) === "true";
    const roots = shallow ? [] : git(top, ["rev-list", "--max-parents=0", "HEAD"]).split("\n").filter(Boolean);
    const relative = path.relative(fs.realpathSync(top), fs.realpathSync(scanRoot)).split(path.sep).join("/");
    return { commitSha, dirty, rootCommitSha: roots.length > 0 ? roots[roots.length - 1] : null, scanRoot: relative };
  } catch {
    return { commitSha: fallbackCommitSha ?? null, dirty: fallbackCommitSha ? false : null, rootCommitSha: null, scanRoot: null };
  }
}

export function buildScanStamps(input: {
  cliVersion: string;
  scanner: { scannerCommit: string; catalogHash: string };
  config: OutputSettings;
  aiInference: boolean;
  structureGraph: boolean;
  git: GitStamps;
}): ScanStamps {
  return {
    scannerCommit: input.scanner.scannerCommit,
    cliVersion: input.cliVersion,
    catalogHash: input.scanner.catalogHash,
    configHash: configHash(input.config),
    aiInference: input.aiInference,
    structureGraph: input.structureGraph,
    ...input.git,
  };
}
