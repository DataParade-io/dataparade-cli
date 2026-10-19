import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `cli/` package root. */
export const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Root of the pinned `@dataparade/scanner` devDependency (the git checkout that
 * pnpm installed). Resolved by path because the package `main` does not exist
 * until the scanner has been built.
 */
export function resolveScannerRoot() {
  return realpathSync(join(cliRoot, "node_modules", "@dataparade", "scanner"));
}
