/**
 * Loads `cli/.env` when not running under Jest.
 * Imported from `bin/load-env` and `src/cli` so both entrypoints behave the same.
 *
 * Resolves the `@dataparade/cli` package root (walks up from this file) so we never
 * load a monorepo-parent `.env`.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";

const CLI_PACKAGE_NAME = "@dataparade/cli";

const tried = { current: false };

/** @internal Exported for unit tests. */
export function findCliPackageRoot(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  const { root } = path.parse(dir);
  /** Fallback when tsc emits package.json under dist/ but no outer root is found. */
  let distPackageRoot: string | undefined;

  while (dir !== root) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const raw = fs.readFileSync(pkgPath, "utf8");
        const pkg = JSON.parse(raw) as { name?: string };
        if (pkg.name === CLI_PACKAGE_NAME) {
          if (path.basename(dir) === "dist") {
            distPackageRoot = dir;
          } else {
            return dir;
          }
        }
      } catch {
        // ignore unreadable or invalid package.json
      }
    }
    dir = path.dirname(dir);
  }
  return distPackageRoot;
}

export function loadCliDotenv(): void {
  if (tried.current) return;
  tried.current = true;
  if (process.env.NODE_ENV === "test") return;

  const cliRoot = findCliPackageRoot(__dirname);
  if (!cliRoot) return;

  const envPath = path.join(cliRoot, ".env");
  if (fs.existsSync(envPath)) {
    config({ path: envPath, override: false });
  }
}

loadCliDotenv();
