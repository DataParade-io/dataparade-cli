import { promises as fs } from "fs";
import * as path from "path";
import type { Dirent } from "fs";
import {
  gitignorePatternToRegex,
  gitignoreRulesForDir,
  isPathIgnored,
  type IgnoreRule,
  toPosixPath,
} from "../ingest/gitignore";
import { shouldSkipDirectoryName } from "../patterns/scan-exclusions";

export type ScanFootprintEstimate = {
  fileCount: number;
  bytesIngested: number;
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
  state: { fileCount: number; bytesIngested: number; capped: boolean },
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
        state.fileCount += 1;
        state.bytesIngested += Math.max(0, stat.size);
        if (state.fileCount >= MAX_FILES_TO_MEASURE) {
          state.capped = true;
        }
      } catch {
        // unreadable file — skip
      }
    }
  }
}

/**
 * Cheap footprint for platform quota preflight (same idea as hosted zip/git estimates).
 */
export async function estimateScanFootprint(
  scanRootDir: string,
  excludePaths: string[] = [],
): Promise<ScanFootprintEstimate> {
  const state = { fileCount: 0, bytesIngested: 0, capped: false };
  await walkFootprint(scanRootDir, scanRootDir, [], excludePaths, state);

  return {
    fileCount: Math.max(1, state.fileCount),
    bytesIngested: Math.max(0, state.bytesIngested),
  };
}
