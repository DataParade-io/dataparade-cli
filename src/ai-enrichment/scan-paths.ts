import type { FileInfo } from "../core/types/file";

export function normScanPath(p: string): string {
  return p.split("\\").join("/");
}

/** Exact repo-relative path match only (preferred for AI prompt excerpts). */
export function resolveScannedFileExact(
  files: FileInfo[],
  pathKey: string,
): FileInfo | undefined {
  const n = normScanPath(pathKey.trim());
  if (!n) return undefined;
  return files.find((f) => normScanPath(f.path) === n);
}

/**
 * Legacy fuzzy match (suffix/prefix). Do not use for security-sensitive or evidence paths.
 * Prefer {@link resolveScannedFileExact}.
 */
export function resolveScannedFile(files: FileInfo[], pathKey: string): FileInfo | undefined {
  const exact = resolveScannedFileExact(files, pathKey);
  if (exact) return exact;
  const n = normScanPath(pathKey.trim());
  if (!n) return undefined;
  return files.find(
    (f) => n.endsWith(normScanPath(f.path)) || normScanPath(f.path).endsWith(n),
  );
}
