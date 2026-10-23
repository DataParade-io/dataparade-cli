import { promises as fs } from "fs";
import * as path from "path";
import type { Dirent } from "fs";
import {
  DEFAULT_EXCLUDED_FILE_GLOBS,
  gitignorePatternToRegex,
  gitignoreRulesForDir,
  isPathIgnored,
  type IgnoreRule,
  shouldSkipDirectoryName,
  toPosixPath,
} from "@dataparade/scanner";

export type ScanFootprintEstimate = {
  fileCount: number;
  bytesIngested: number;
};

/** Files and folders the scan will walk, with the share of each top-level folder. */
export type ScanTreeSummary = {
  fileCount: number;
  directoryCount: number;
  bytes: number;
  /** True when the walk stopped at {@link MAX_FILES_TO_MEASURE} files. */
  capped: boolean;
  /** Top-level folders under the scan root, largest file count first. */
  topLevelFolders: { name: string; fileCount: number; bytes: number }[];
};

type WalkState = {
  fileCount: number;
  bytesIngested: number;
  directoryCount: number;
  capped: boolean;
  topLevel: Map<string, { fileCount: number; bytes: number }>;
};

const MAX_FILES_TO_MEASURE = 50_000;

function normalizeUserPattern(pattern: string): string {
  return toPosixPath(pattern.replace(/^\.\/+/, "").trim());
}

function isExcludedByUserPatterns(
  relativePath: string,
  isDirectory: boolean,
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

    const regex = gitignorePatternToRegex(pattern, isDirectory);
    if (regex.test(rel)) return true;
  }
  return false;
}

async function walkFootprint(
  currentDir: string,
  rootDir: string,
  accumulatedRules: IgnoreRule[],
  excludePaths: string[],
  state: WalkState,
): Promise<void> {
  if (state.capped) return;

  const rules = await gitignoreRulesForDir(currentDir, accumulatedRules);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (state.capped) return;

    const entryPath = path.join(currentDir, entry.name);
    const relativePath = toPosixPath(path.relative(rootDir, entryPath));

    if (entry.isDirectory()) {
      if (shouldSkipDirectoryName(entry.name)) continue;
      if (
        relativePath &&
        isExcludedByUserPatterns(relativePath, true, excludePaths)
      ) {
        continue;
      }
      if (isPathIgnored(entryPath, true, rules)) continue;
      state.directoryCount += 1;
      await walkFootprint(entryPath, rootDir, rules, excludePaths, state);
    } else if (entry.isFile()) {
      if (
        relativePath &&
        isExcludedByUserPatterns(relativePath, false, excludePaths)
      ) {
        continue;
      }
      if (isPathIgnored(entryPath, false, rules)) continue;

      try {
        const stat = await fs.stat(entryPath);
        const size = Math.max(0, stat.size);
        state.fileCount += 1;
        state.bytesIngested += size;
        const slash = relativePath.indexOf("/");
        if (slash > 0) {
          const name = relativePath.slice(0, slash);
          const folder = state.topLevel.get(name) ?? { fileCount: 0, bytes: 0 };
          folder.fileCount += 1;
          folder.bytes += size;
          state.topLevel.set(name, folder);
        }
        if (state.fileCount >= MAX_FILES_TO_MEASURE) {
          state.capped = true;
        }
      } catch {
        // unreadable file — skip
      }
    }
  }
}

function newWalkState(): WalkState {
  return {
    fileCount: 0,
    bytesIngested: 0,
    directoryCount: 0,
    capped: false,
    topLevel: new Map(),
  };
}

/**
 * Cheap footprint for platform quota preflight (same idea as hosted zip/git estimates).
 */
export async function estimateScanFootprint(
  scanRootDir: string,
  excludePaths: string[] = [],
): Promise<ScanFootprintEstimate> {
  const state = newWalkState();
  await walkFootprint(scanRootDir, scanRootDir, [], excludePaths, state);

  return {
    fileCount: Math.max(1, state.fileCount),
    bytesIngested: Math.max(0, state.bytesIngested),
  };
}

/**
 * Count the files and folders a scan walks. Prunes the same directories as the scanner's
 * ingest: default excluded names, hidden folders, `--exclude` patterns and `.gitignore`.
 */
export async function summarizeScanTree(
  scanRootDir: string,
  excludePaths: string[] = [],
): Promise<ScanTreeSummary> {
  const state = newWalkState();
  await walkFootprint(
    scanRootDir,
    scanRootDir,
    [],
    [...DEFAULT_EXCLUDED_FILE_GLOBS, ...excludePaths],
    state,
  );
  return {
    fileCount: state.fileCount,
    directoryCount: state.directoryCount,
    bytes: state.bytesIngested,
    capped: state.capped,
    topLevelFolders: [...state.topLevel.entries()]
      .map(([name, folder]) => ({ name, ...folder }))
      .sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name)),
  };
}

/**
 * The scanner reads at most 20,000 files and 200 MB of source per scan (its ingest caps,
 * DEFAULT_MAX_FILE_COUNT and DEFAULT_MAX_TOTAL_BYTES). A tree above either limit is
 * scanned only in part and needs the most time and memory, so it gets a warning.
 */
export const LARGE_TREE_FILE_COUNT = 20_000;
export const LARGE_TREE_BYTES = 200 * 1024 * 1024;

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** One line with the counts, plus a warning when the tree is very large. */
export function describeScanTree(summary: ScanTreeSummary): {
  line: string;
  warning?: string;
} {
  const files = `${formatCount(summary.fileCount)}${summary.capped ? "+" : ""}`;
  const line = `Scanning ${files} files in ${formatCount(summary.directoryCount)} folders (${formatMegabytes(summary.bytes)}).`;
  const large =
    summary.capped ||
    summary.fileCount > LARGE_TREE_FILE_COUNT ||
    summary.bytes > LARGE_TREE_BYTES;
  if (!large) return { line };

  const biggest = summary.topLevelFolders.slice(0, 3);
  const named = biggest
    .map((folder) => `${folder.name}/ (${formatCount(folder.fileCount)} files)`)
    .join(", ");
  const example = biggest.map((folder) => `'${folder.name}/**'`).join(" ");
  const warning =
    `This is a large tree: the scan reads at most ${formatCount(LARGE_TREE_FILE_COUNT)} files and ` +
    `${formatMegabytes(LARGE_TREE_BYTES)}, and may be slow or run out of memory.` +
    (biggest.length > 0
      ? ` The biggest folders are ${named}. If they hold no application code, skip them with --exclude ${example}.`
      : "");
  return { line, warning };
}
