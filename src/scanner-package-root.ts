import path from "path";

/** Absolute path to the installed `@dataparade/scanner` package root. */
export function getScannerPackageRoot(): string {
  const scannerMain = require.resolve("@dataparade/scanner");
  return path.join(path.dirname(scannerMain), "..", "..");
}
