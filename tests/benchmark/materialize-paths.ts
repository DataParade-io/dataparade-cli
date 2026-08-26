export type IncludePathKind = "directory" | "file";

export interface ClassifiedIncludePath {
  original: string;
  kind: IncludePathKind;
  /** Path without trailing slashes. */
  normalized: string;
}

export function classifyIncludePath(entry: string): ClassifiedIncludePath {
  const trimmed = entry.trim().replace(/\/+$/, "");
  if (entry.trim().endsWith("/")) {
    return { original: entry, kind: "directory", normalized: trimmed };
  }

  const slash = trimmed.lastIndexOf("/");
  const base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  if (base.includes(".") && !base.startsWith(".")) {
    return { original: entry, kind: "file", normalized: trimmed };
  }

  return { original: entry, kind: "directory", normalized: trimmed };
}

/** Directory paths suitable for `git sparse-checkout set` in cone mode. */
export function sparseConeDirectories(includePaths: string[]): string[] {
  const directories = new Set<string>();

  for (const entry of includePaths) {
    const classified = classifyIncludePath(entry);
    if (classified.kind === "directory") {
      directories.add(classified.normalized);
      continue;
    }

    const slash = classified.normalized.lastIndexOf("/");
    if (slash < 0) {
      throw new Error(
        `File-only include path '${entry}' cannot be used with cone sparse checkout`,
      );
    }
    directories.add(classified.normalized.slice(0, slash));
  }

  return [...directories].sort();
}

export function requiredScopePaths(
  includePaths: string[],
): Array<{ path: string; kind: IncludePathKind }> {
  return includePaths.map((entry) => {
    const classified = classifyIncludePath(entry);
    return { path: classified.normalized, kind: classified.kind };
  });
}

export function parseConeSparseCheckoutPatterns(content: string): Set<string> {
  const patterns = new Set<string>();

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("/") && !trimmed.startsWith("/*")) {
      patterns.add(trimmed.replace(/\/$/, ""));
    }
  }

  return patterns;
}

export function expectedConeSparsePatterns(directories: string[]): Set<string> {
  return new Set(
    directories.map((directory) => `/${directory.replace(/^\/+/, "")}`),
  );
}

export function isSparseCheckoutSatisfied(
  sparseCheckoutContent: string,
  includePaths: string[],
): boolean {
  const expected = expectedConeSparsePatterns(sparseConeDirectories(includePaths));
  const actual = parseConeSparseCheckoutPatterns(sparseCheckoutContent);

  for (const pattern of expected) {
    if (!actual.has(pattern)) {
      return false;
    }
  }

  return true;
}

export function findMissingScopePaths(
  includePaths: string[],
  exists: (relativePath: string) => boolean,
  isDirectory: (relativePath: string) => boolean,
): string[] {
  const missing: string[] = [];

  for (const { path: scopePath, kind } of requiredScopePaths(includePaths)) {
    if (!exists(scopePath)) {
      missing.push(scopePath);
      continue;
    }

    if (kind === "directory" && !isDirectory(scopePath)) {
      missing.push(scopePath);
    }

    if (kind === "file" && isDirectory(scopePath)) {
      missing.push(scopePath);
    }
  }

  return missing;
}

export interface MaterializationCheck {
  head: string;
  commit: string;
  includePaths: string[];
  exists: (relativePath: string) => boolean;
  isDirectory: (relativePath: string) => boolean;
  sparseCheckoutContent: string | null;
}

export type SafeHeadReadResult =
  | { status: "ok"; head: string }
  | { status: "missing" }
  | { status: "error" };

/** Read HEAD without throwing when the target is a partial clone. */
export function readHeadSafely(readHead: () => string): SafeHeadReadResult {
  try {
    const head = readHead().trim();
    if (!head) {
      return { status: "missing" };
    }
    return { status: "ok", head };
  } catch {
    return { status: "error" };
  }
}

export type MaterializeConcurrencyAction =
  | "use-complete"
  | "wait-for-peer"
  | "remove-incomplete"
  | "materialize-staging";

export interface MaterializeConcurrencyInput {
  targetExists: boolean;
  headRead: SafeHeadReadResult;
  materialization: { complete: boolean };
  lockHeldByPeer: boolean;
  lockStale: boolean;
}

/**
 * Decide how to handle a cache target when another process may be materializing.
 * Deterministic and unit-testable without spawning processes.
 */
export function planMaterializeConcurrency(
  input: MaterializeConcurrencyInput,
): MaterializeConcurrencyAction {
  if (input.targetExists && input.materialization.complete) {
    return "use-complete";
  }

  if (input.lockHeldByPeer && !input.lockStale) {
    return "wait-for-peer";
  }

  if (input.targetExists) {
    return "remove-incomplete";
  }

  return "materialize-staging";
}

export function stagingDirectoryName(targetDir: string, token: string): string {
  return `${targetDir}.staging-${token}`;
}

export function lockFilePath(targetDir: string): string {
  return `${targetDir}.lock`;
}

export function isLockStale(lockAgeMs: number, maxAgeMs: number): boolean {
  return lockAgeMs > maxAgeMs;
}

export function isMaterializationComplete(
  check: MaterializationCheck,
): { complete: boolean; reason?: string } {
  if (check.head !== check.commit) {
    return { complete: false, reason: "commit mismatch" };
  }

  const missing = findMissingScopePaths(
    check.includePaths,
    check.exists,
    check.isDirectory,
  );
  if (missing.length > 0) {
    return {
      complete: false,
      reason: `missing scope paths: ${missing.join(", ")}`,
    };
  }

  if (check.includePaths.length === 0) {
    return { complete: true };
  }

  if (check.sparseCheckoutContent === null) {
    return { complete: false, reason: "sparse checkout not configured" };
  }

  if (!isSparseCheckoutSatisfied(check.sparseCheckoutContent, check.includePaths)) {
    return { complete: false, reason: "sparse checkout patterns incomplete" };
  }

  return { complete: true };
}
