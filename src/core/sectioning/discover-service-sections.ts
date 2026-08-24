import fs from "fs/promises";
import path from "path";

import type { RawFinding } from "../types/detection";
import {
  gitignoreRulesForDir,
  isPathIgnored,
  type IgnoreRule,
  toPosixPath,
} from "../../ingest/gitignore";
import { shouldSkipDirectoryName } from "../../patterns/scan-exclusions";

export interface ServiceSection {
  /**
   * Stable identifier used by the CLI import/layout layer.
   * Stored as `node.data.section_id`.
   */
  id: string;
  /**
   * Human readable label stored as `node.data.section_label`.
   */
  label: string;
  /**
   * Role stored as `node.data.section_role`.
   *
   * - `root`: fallback scan-root / non-manifest-tagged files
   * - `service`: directories that contain at least one discovered manifest
   */
  role: "root" | "service";
  /**
   * Relative directory path (POSIX, relative to scan root) used for matching.
   * The root/fallback section uses ''.
   */
  sectionDir: string;
  /**
   * Manifest files discovered under this section directory (relative, POSIX).
   */
  manifestPaths: string[];
  /** npm/pnpm `name` from package.json when this section has one. */
  packageName?: string;
  /**
   * Workspace-level package hub for monorepo rollup (see inferred monorepo depth).
   * When unset, all `service` sections are treated as primary.
   */
  isPrimaryMonorepoPackage?: boolean;
  /**
   * Section registered from Terraform config only (no `package.json` under `sectionDir`).
   * Set at discovery; used by {@link isTerraformStackSection} instead of path heuristics.
   */
  isTerraformStack?: boolean;
}

export interface DiscoverServiceSectionsOptions {
  excludePaths?: string[];
  terraformStackSectionPathDepth?: number;
  /**
   * When `terraformStackSectionPathDepth` is omitted, infer `N` from `.tf` layout.
   * Defaults to true via `createDefaultScanConfiguration`; set false to disable.
   */
  autoInferTerraformStackSectionPathDepth?: boolean;
  /** Override inferred workspace package depth (POSIX segments under scan root). */
  monorepoPackageSectionPathDepth?: number;
  /**
   * When `monorepoPackageSectionPathDepth` is omitted, infer workspace depth from
   * `package.json` layout. Defaults to true via `createDefaultScanConfiguration`.
   */
  autoInferMonorepoPackageSectionPathDepth?: boolean;
}

export interface DiscoverServiceSectionsResult {
  sections: ServiceSection[];
  /** Set when depth was inferred (not passed explicitly). */
  inferredTerraformStackSectionPathDepth?: number;
  inferredMonorepoPackageSectionPathDepth?: number;
  /** Effective monorepo depth after inference or explicit override. */
  monorepoPackageSectionPathDepth?: number;
}

function patternToRegex(pattern: string): RegExp {
  let escaped = pattern.replace(/[-\\^$+?.()|[\]{}*?]/g, "\\$&");
  escaped = escaped.replace(/\\\*\\\*/g, ".*");
  escaped = escaped.replace(/\\\*/g, "[^/]*");
  escaped = escaped.replace(/\\\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

function normalizeUserPattern(pattern: string): string {
  return toPosixPath(pattern.replace(/^\.\/+/, "").trim());
}

function isExcludedByUserPatterns(
  relativePath: string,
  excludePaths: string[],
): boolean {
  const rel = toPosixPath(relativePath);
  for (const rawPattern of excludePaths) {
    const pattern = normalizeUserPattern(rawPattern);
    if (!pattern) continue;

    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3).replace(/\/$/, "");
      if (rel === prefix || rel.startsWith(`${prefix}/`)) return true;
    }

    if (patternToRegex(pattern).test(rel)) return true;
  }
  return false;
}

async function walkForManifests(
  currentDirAbs: string,
  rootDirAbs: string,
  excludePaths: string[],
  accumulatedGitignoreRules: IgnoreRule[],
  onManifestRelPath: (manifestRelPosix: string) => void,
): Promise<void> {
  const gitignoreRules = await gitignoreRulesForDir(
    currentDirAbs,
    accumulatedGitignoreRules,
  );

  let entries: any[];
  try {
    entries = await fs.readdir(currentDirAbs, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPathAbs = path.join(currentDirAbs, entry.name);
    const entryRelPosix = toPosixPath(path.relative(rootDirAbs, entryPathAbs));

    if (entry.isDirectory()) {
      if (shouldSkipDirectoryName(entry.name)) continue;
      if (
        entryRelPosix &&
        isExcludedByUserPatterns(entryRelPosix, excludePaths)
      ) {
        continue;
      }
      if (isPathIgnored(entryPathAbs, true, gitignoreRules)) {
        continue;
      }
      await walkForManifests(
        entryPathAbs,
        rootDirAbs,
        excludePaths,
        gitignoreRules,
        onManifestRelPath,
      );
      continue;
    }

    if (!entry.isFile()) continue;
    if (isPathIgnored(entryPathAbs, false, gitignoreRules)) {
      continue;
    }

    const name = entry.name;
    const lower = name.toLowerCase();

    const isTsManifest = lower === "package.json";
    const isRequirements = lower.startsWith("requirements") && lower.endsWith(".txt");
    const isPyproject = lower === "pyproject.toml";
    const isPipfile = lower === "pipfile";
    const isDotnetProject =
      lower.endsWith(".csproj") ||
      lower.endsWith(".fsproj") ||
      lower.endsWith(".vbproj");
    // `CMakeLists.txt` is deliberately excluded: C++ projects place one in
    // nearly every subdirectory, which would shatter the graph into sections.
    // go.mod is the canonical Go module root, so it maps exactly onto a
    // service boundary in a multi-module repository.
    const isGoModule = lower === "go.mod";
    // Maven and Gradle both place a build file at each module root, and on the
    // JVM a module is the deployable unit — unlike `CMakeLists.txt`, one build
    // file per directory *is* the service boundary. `settings.gradle` marks the
    // root of a multi-project build rather than a module, so it is not a
    // marker; the root's own `build.gradle` already covers that directory.
    const isJvmManifest =
      lower === "pom.xml" ||
      lower === "build.gradle" ||
      lower === "build.gradle.kts";
    const isCppManifest =
      lower === "vcpkg.json" ||
      lower === "conanfile.txt" ||
      lower === "conanfile.py";

    if (
      !isTsManifest &&
      !isRequirements &&
      !isPyproject &&
      !isPipfile &&
      !isDotnetProject &&
      !isGoModule &&
      !isJvmManifest &&
      !isCppManifest
    ) {
      continue;
    }

    const manifestRel = path.relative(rootDirAbs, entryPathAbs);
    if (manifestRel.startsWith("..") || path.isAbsolute(manifestRel)) continue;
    if (isExcludedByUserPatterns(toPosixPath(manifestRel), excludePaths)) {
      continue;
    }

    onManifestRelPath(toPosixPath(manifestRel));
  }
}

/**
 * True for Terraform HCL module files in a directory (any `*.tf`).
 * Excludes `.tf.json` (Terraform JSON syntax). Does not treat `.tfvars` as a
 * module root marker — those files use a different suffix.
 */
function isTerraformConfigFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith(".tf")) return false;
  if (lower.endsWith(".tf.json")) return false;
  return true;
}

async function walkForTerraformConfigFiles(
  currentDirAbs: string,
  rootDirAbs: string,
  excludePaths: string[],
  accumulatedGitignoreRules: IgnoreRule[],
  onTerraformConfigRelPosix: (relPosix: string) => void,
): Promise<void> {
  const gitignoreRules = await gitignoreRulesForDir(
    currentDirAbs,
    accumulatedGitignoreRules,
  );

  let entries: any[];
  try {
    entries = await fs.readdir(currentDirAbs, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPathAbs = path.join(currentDirAbs, entry.name);
    const entryRelPosix = toPosixPath(path.relative(rootDirAbs, entryPathAbs));

    if (entry.isDirectory()) {
      if (shouldSkipDirectoryName(entry.name)) continue;
      if (
        entryRelPosix &&
        isExcludedByUserPatterns(entryRelPosix, excludePaths)
      ) {
        continue;
      }
      if (isPathIgnored(entryPathAbs, true, gitignoreRules)) {
        continue;
      }
      await walkForTerraformConfigFiles(
        entryPathAbs,
        rootDirAbs,
        excludePaths,
        gitignoreRules,
        onTerraformConfigRelPosix,
      );
      continue;
    }

    if (!entry.isFile()) continue;
    if (isPathIgnored(entryPathAbs, false, gitignoreRules)) {
      continue;
    }
    if (!isTerraformConfigFileName(entry.name)) continue;

    const manifestRel = path.relative(rootDirAbs, entryPathAbs);
    if (manifestRel.startsWith("..") || path.isAbsolute(manifestRel)) continue;
    const relPosix = toPosixPath(manifestRel);
    if (isExcludedByUserPatterns(relPosix, excludePaths)) continue;

    onTerraformConfigRelPosix(relPosix);
  }
}

function sectionKeyFromDir(sectionDirPosix: string): string {
  // dirname('package.json') === '.' in POSIX; treat it as scan-root.
  if (!sectionDirPosix || sectionDirPosix === ".") return "root";
  return sectionDirPosix;
}

function labelFromPackageName(packageName: string, fallbackBasename: string): string {
  const trimmed = packageName.trim();
  if (!trimmed) return fallbackBasename;
  const slash = trimmed.lastIndexOf("/");
  const base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  const withoutScope = base.replace(/^@/, "").trim();
  return withoutScope || fallbackBasename;
}

function labelFromSectionDir(
  sectionDirPosix: string,
  packageName?: string,
): string {
  const key = sectionKeyFromDir(sectionDirPosix);
  if (key === "root") return "root";
  const basename = path.posix.basename(sectionDirPosix);
  if (packageName) return labelFromPackageName(packageName, basename);
  return basename;
}

async function readPackageJsonName(manifestAbsPath: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(manifestAbsPath, "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    if (typeof parsed.name === "string" && parsed.name.trim()) {
      return parsed.name.trim();
    }
  } catch {
    // ignore unreadable or invalid package.json
  }
  return undefined;
}

function sectionHasPackageManifest(manifestPaths: string[]): boolean {
  return manifestPaths.some((p) => path.posix.basename(p) === "package.json");
}

function manifestPathIsTerraformConfig(manifestRelPosix: string): boolean {
  return isTerraformConfigFileName(path.posix.basename(manifestRelPosix));
}

/** True when `manifestPaths` are exclusively `*.tf` files (no app manifests). */
function sectionIsTerraformOnlyStack(manifestPaths: string[]): boolean {
  if (manifestPaths.length === 0) return false;
  if (sectionHasPackageManifest(manifestPaths)) return false;
  return manifestPaths.every(manifestPathIsTerraformConfig);
}

function roleFromSectionDir(sectionDirPosix: string): "root" | "service" {
  const key = sectionKeyFromDir(sectionDirPosix);
  return key === "root" ? "root" : "service";
}

function registerTerraformStackSections(
  bySectionDir: Map<string, { manifestPaths: string[] }>,
  tfConfigRelPaths: string[],
  tfDepth: number,
  excludePaths: string[],
): void {
  for (const tfConfigRelPosix of tfConfigRelPaths) {
    const dir = path.posix.dirname(tfConfigRelPosix);
    const sectionDir = dir === "." ? "" : dir;
    if (!sectionDir) continue;

    const segmentCount = sectionDir.split("/").length;
    if (segmentCount !== tfDepth) continue;

    if (isExcludedByUserPatterns(sectionDir, excludePaths)) continue;

    const existing = bySectionDir.get(sectionDir);
    if (existing) {
      if (!existing.manifestPaths.includes(tfConfigRelPosix)) {
        existing.manifestPaths.push(tfConfigRelPosix);
      }
    } else {
      bySectionDir.set(sectionDir, { manifestPaths: [tfConfigRelPosix] });
    }
  }
}

/**
 * Pick path depth `N` where the most Terraform stack directories live.
 * Prefers directories that contain `main.tf`; falls back to any `*.tf` directory.
 * Tie-break: deeper `N` (more specific stack roots).
 */
export function inferTerraformStackSectionPathDepth(
  tfConfigRelPaths: string[],
): number | undefined {
  const mainTfDirs = new Set<string>();
  const anyTfDirs = new Set<string>();

  for (const rel of tfConfigRelPaths) {
    const dir = path.posix.dirname(rel);
    if (!dir || dir === ".") continue;
    anyTfDirs.add(dir);
    if (path.posix.basename(rel).toLowerCase() === "main.tf") {
      mainTfDirs.add(dir);
    }
  }

  const stackDirs = mainTfDirs.size > 0 ? mainTfDirs : anyTfDirs;
  if (stackDirs.size === 0) return undefined;

  const depthCounts = new Map<number, number>();
  for (const dir of stackDirs) {
    const depth = dir.split("/").length;
    depthCounts.set(depth, (depthCounts.get(depth) ?? 0) + 1);
  }

  let bestDepth: number | undefined;
  let bestCount = 0;
  for (const [depth, count] of depthCounts) {
    if (
      count > bestCount ||
      (count === bestCount &&
        bestDepth != null &&
        depth > bestDepth)
    ) {
      bestCount = count;
      bestDepth = depth;
    }
  }

  return bestDepth;
}

/**
 * Pick workspace package depth: shallowest path depth with at least two
 * `package.json` directories (typical `packages/*` monorepo layout).
 */
export function inferMonorepoPackageSectionPathDepth(
  packageJsonRelPaths: string[],
): number | undefined {
  const dirs = new Set<string>();
  for (const rel of packageJsonRelPaths) {
    const dir = path.posix.dirname(rel);
    if (!dir || dir === ".") continue;
    dirs.add(dir);
  }
  if (dirs.size < 2) return undefined;

  const depthCounts = new Map<number, number>();
  for (const dir of dirs) {
    const depth = dir.split("/").length;
    depthCounts.set(depth, (depthCounts.get(depth) ?? 0) + 1);
  }

  let bestDepth: number | undefined;
  let bestCount = 0;
  for (const [depth, count] of depthCounts) {
    if (count < 2) continue;
    if (
      count > bestCount ||
      (count === bestCount && bestDepth != null && depth < bestDepth)
    ) {
      bestCount = count;
      bestDepth = depth;
    }
  }

  return bestDepth;
}

export function rollupSectionIdToMonorepoDepth(
  sectionId: string,
  depth: number,
): string {
  if (sectionId === "root" || !sectionId.includes("/")) return sectionId;
  const segments = sectionId.split("/");
  if (segments.length <= depth) return sectionId;
  return segments.slice(0, depth).join("/");
}

function ensureMonorepoParentPackageSections(
  bySectionDir: Map<string, { manifestPaths: string[]; packageName?: string }>,
  monorepoDepth: number,
): void {
  for (const sectionDir of [...bySectionDir.keys()]) {
    if (!sectionDir) continue;
    const segments = sectionDir.split("/");
    if (segments.length <= monorepoDepth) continue;
    const parentDir = segments.slice(0, monorepoDepth).join("/");
    if (!bySectionDir.has(parentDir)) {
      bySectionDir.set(parentDir, { manifestPaths: [] });
    }
  }
}

function markPrimaryMonorepoPackageSections(
  sections: ServiceSection[],
  monorepoDepth: number | undefined,
): void {
  if (monorepoDepth == null) return;
  for (const section of sections) {
    if (section.role !== "service" || !section.sectionDir) continue;
    section.isPrimaryMonorepoPackage =
      section.sectionDir.split("/").length === monorepoDepth;
  }
}

export async function discoverServiceSections(
  rootPath: string,
  opts: DiscoverServiceSectionsOptions = {},
): Promise<DiscoverServiceSectionsResult> {
  const rootDirAbs = path.resolve(rootPath);
  const excludePaths = opts.excludePaths ?? [];

  // Keyed by directory (relative to root). Root uses ''.
  const bySectionDir = new Map<
    string,
    { manifestPaths: string[]; packageName?: string }
  >();
  const packageJsonRelPaths: string[] = [];

  await walkForManifests(
    rootDirAbs,
    rootDirAbs,
    excludePaths,
    [],
    (manifestRelPosix) => {
      const dir = path.posix.dirname(manifestRelPosix);
      const sectionDir = dir === "." ? "" : dir;
      const isPackageJson =
        path.posix.basename(manifestRelPosix) === "package.json";
      if (isPackageJson) packageJsonRelPaths.push(manifestRelPosix);

      const entry = bySectionDir.get(sectionDir);
      if (entry) {
        entry.manifestPaths.push(manifestRelPosix);
      } else {
        bySectionDir.set(sectionDir, { manifestPaths: [manifestRelPosix] });
      }
    },
  );

  for (const manifestRelPosix of packageJsonRelPaths) {
    const dir = path.posix.dirname(manifestRelPosix);
    const sectionDir = dir === "." ? "" : dir;
    const entry = bySectionDir.get(sectionDir);
    if (!entry) continue;
    const packageName = await readPackageJsonName(
      path.join(rootDirAbs, manifestRelPosix),
    );
    if (packageName) entry.packageName = packageName;
  }

  let monorepoDepth = opts.monorepoPackageSectionPathDepth;
  let inferredMonorepoPackageSectionPathDepth: number | undefined;
  const autoInferMonorepo = opts.autoInferMonorepoPackageSectionPathDepth !== false;
  if (
    monorepoDepth == null &&
    autoInferMonorepo &&
    packageJsonRelPaths.length >= 2
  ) {
    const inferred = inferMonorepoPackageSectionPathDepth(packageJsonRelPaths);
    if (inferred != null && inferred > 0) {
      monorepoDepth = inferred;
      inferredMonorepoPackageSectionPathDepth = inferred;
      ensureMonorepoParentPackageSections(bySectionDir, monorepoDepth);
    }
  } else if (
    typeof monorepoDepth === "number" &&
    Number.isInteger(monorepoDepth) &&
    monorepoDepth > 0
  ) {
    ensureMonorepoParentPackageSections(bySectionDir, monorepoDepth);
  }

  const tfConfigRelPaths: string[] = [];
  await walkForTerraformConfigFiles(
    rootDirAbs,
    rootDirAbs,
    excludePaths,
    [],
    (rel) => tfConfigRelPaths.push(rel),
  );

  let tfDepth = opts.terraformStackSectionPathDepth;
  let inferredTerraformStackSectionPathDepth: number | undefined;

  const autoInfer = opts.autoInferTerraformStackSectionPathDepth !== false;
  if (
    tfDepth == null &&
    autoInfer &&
    tfConfigRelPaths.length > 0
  ) {
    const inferred = inferTerraformStackSectionPathDepth(tfConfigRelPaths);
    if (inferred != null && inferred > 0) {
      tfDepth = inferred;
      inferredTerraformStackSectionPathDepth = inferred;
    }
  }

  if (
    typeof tfDepth === "number" &&
    Number.isInteger(tfDepth) &&
    tfDepth > 0
  ) {
    registerTerraformStackSections(
      bySectionDir,
      tfConfigRelPaths,
      tfDepth,
      excludePaths,
    );
  }

  // Always include a fallback section to avoid "no section_id" surprises.
  if (!bySectionDir.has("")) bySectionDir.set("", { manifestPaths: [] });

  const sections: ServiceSection[] = Array.from(bySectionDir.entries())
    .map(([sectionDir, v]) => {
      const id = sectionKeyFromDir(sectionDir);
      const isTerraformStack = sectionIsTerraformOnlyStack(v.manifestPaths);
      return {
        id,
        label: labelFromSectionDir(sectionDir, v.packageName),
        role: roleFromSectionDir(sectionDir),
        sectionDir,
        manifestPaths: v.manifestPaths.sort((a, b) => a.localeCompare(b)),
        packageName: v.packageName,
        ...(isTerraformStack ? { isTerraformStack: true as const } : {}),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  markPrimaryMonorepoPackageSections(sections, monorepoDepth);

  return {
    sections,
    inferredTerraformStackSectionPathDepth,
    inferredMonorepoPackageSectionPathDepth,
    monorepoPackageSectionPathDepth: monorepoDepth,
  };
}

function findNearestSectionForFile(
  filePathRelPosix: string,
  sections: ServiceSection[],
): ServiceSection {
  // Longest prefix match on section directory.
  let best: ServiceSection | undefined;
  let bestLen = -1;

  for (const s of sections) {
    if (!s.sectionDir) continue; // root handled as fallback
    if (
      filePathRelPosix === s.sectionDir ||
      filePathRelPosix.startsWith(`${s.sectionDir}/`)
    ) {
      if (s.sectionDir.length > bestLen) {
        best = s;
        bestLen = s.sectionDir.length;
      }
    }
  }

  return best ?? sections.find((s) => s.id === "root") ?? sections[0];
}

function resolveSectionForFinding(
  filePathRelPosix: string,
  sections: ServiceSection[],
  monorepoRollupDepth: number | undefined,
): ServiceSection {
  const section = findNearestSectionForFile(filePathRelPosix, sections);
  if (
    monorepoRollupDepth == null ||
    !section.sectionDir ||
    !sectionHasPackageManifest(section.manifestPaths)
  ) {
    return section;
  }

  const segmentCount = section.sectionDir.split("/").length;
  if (segmentCount <= monorepoRollupDepth) return section;

  const rolledId = rollupSectionIdToMonorepoDepth(section.id, monorepoRollupDepth);
  const rolled = sections.find((s) => s.id === rolledId);
  if (rolled) return rolled;

  return {
    ...section,
    id: rolledId,
    label: path.posix.basename(rolledId),
    sectionDir: rolledId,
    isPrimaryMonorepoPackage: true,
  };
}

export function tagFindingsWithServiceSections(
  findings: RawFinding[],
  sections: ServiceSection[],
  opts?: { monorepoPackageSectionPathDepth?: number },
): void {
  if (!findings.length) return;

  const monorepoRollupDepth = opts?.monorepoPackageSectionPathDepth;

  for (const finding of findings) {
    const filePathRelPosix = toPosixPath(finding.location.filePath);
    const section = resolveSectionForFinding(
      filePathRelPosix,
      sections,
      monorepoRollupDepth,
    );

    // Thread through classification via component.properties.
    finding.properties.section_id = section.id;
    finding.properties.section_label = section.label;
    finding.properties.section_role = section.role;
    if (section.packageName) {
      finding.properties.package_name = section.packageName;
    }
  }
}

