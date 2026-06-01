import * as path from "path";

export function resolvePathUnderScanRoot(
  scanRootDir: string,
  userPath: string,
): { ok: true; resolved: string } | { ok: false; message: string } {
  const trimmed = userPath.trim();
  if (!trimmed) {
    return { ok: false, message: "path is empty" };
  }

  const scanRoot = path.resolve(scanRootDir);
  const abs = path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.resolve(scanRoot, trimmed);

  const prefix = `${scanRoot}${path.sep}`;
  if (abs !== scanRoot && !abs.startsWith(prefix)) {
    return {
      ok: false,
      message: `path must be under scan root: ${userPath}`,
    };
  }

  return { ok: true, resolved: abs };
}
