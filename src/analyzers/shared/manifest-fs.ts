import * as path from "path";
import type { Dirent } from "fs";
import { promises as fs } from "fs";

import type { BudgetState } from "./manifest-budgets";
import {
  gitignoreRulesForDir,
  isPathIgnored,
  type IgnoreRule,
  toPosixPath,
} from "../../ingest/gitignore";
import { shouldSkipDirectoryName } from "../../patterns/scan-exclusions";

export interface WalkForManifestsOptions {
  rootDir: string;
  state: BudgetState;
  excludePaths?: string[];
  /**
   * Predicate that selects which files in a directory should be treated as manifests.
   */
  isManifestFile: (entry: Dirent, entryPath: string) => boolean;
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

export async function walkForManifests(
  dir: string,
  out: string[],
  options: WalkForManifestsOptions,
  accumulatedGitignoreRules: IgnoreRule[] = [],
): Promise<void> {
  const { rootDir, state, isManifestFile } = options;
  const excludePaths = options.excludePaths ?? [];
  if (state.stopped) return;

  const gitignoreRules = await gitignoreRulesForDir(dir, accumulatedGitignoreRules);

  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (state.stopped) return;
    const entryPath = path.join(dir, entry.name);
    const relativePath = toPosixPath(path.relative(rootDir, entryPath));

    if (entry.isDirectory()) {
      if (shouldSkipDirectoryName(entry.name)) continue;
      if (
        relativePath &&
        isExcludedByUserPatterns(relativePath, excludePaths)
      ) {
        continue;
      }
      if (isPathIgnored(entryPath, true, gitignoreRules)) {
        continue;
      }
      await walkForManifests(entryPath, out, options, gitignoreRules);
      continue;
    }

    if (!entry.isFile()) continue;
    if (isPathIgnored(entryPath, false, gitignoreRules)) {
      continue;
    }
    if (
      relativePath &&
      isExcludedByUserPatterns(relativePath, excludePaths)
    ) {
      continue;
    }
    if (!isManifestFile(entry, entryPath)) continue;

    const rel = path.relative(rootDir, entryPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;

    const stat = await fs.stat(entryPath).catch(() => undefined);
    const size = stat?.size ?? 0;

    if (size > state.maxManifestFileSizeBytes) {
      state.onWarning?.(
        `manifest-scan: skipping oversized manifest (${rel}) - size ${size}B exceeds limit ${state.maxManifestFileSizeBytes}B`,
      );
      continue;
    }

    if (state.manifestFiles >= state.maxManifestFiles) {
      state.stopped = true;
      if (!state.warned) {
        state.warned = true;
        state.onWarning?.(
          `manifest-scan: manifest scan budget exceeded (maxManifestFiles=${state.maxManifestFiles}). Stopping scan early.`,
        );
      }
      return;
    }

    if (state.totalReadBytes + size > state.maxTotalManifestReadBytes) {
      state.stopped = true;
      if (!state.warned) {
        state.warned = true;
        state.onWarning?.(
          `manifest-scan: manifest scan budget exceeded (maxTotalManifestReadBytes=${state.maxTotalManifestReadBytes}). Stopping scan early.`,
        );
      }
      return;
    }

    state.manifestFiles += 1;
    state.totalReadBytes += size;
    out.push(entryPath);
  }
}

