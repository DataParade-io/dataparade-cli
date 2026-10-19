// Makes sure the pinned @dataparade/scanner (a devDependency fetched from Git) has its
// compiled output in dist/. pnpm normally builds it via the scanner's `prepare` script on
// install; this is the fallback for installs that skipped it (pnpm cache hit, --ignore-scripts).
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { cliRoot, resolveScannerRoot } from "./scanner-root.mjs";

const require = createRequire(import.meta.url);

function main() {
  const scannerRoot = resolveScannerRoot();
  if (existsSync(join(scannerRoot, "dist", "src", "index.js"))) {
    return;
  }

  // The git checkout has no devDependencies, so build it with the CLI's own TypeScript and
  // @types/node using a throwaway tsconfig that only covers the scanner's src/.
  const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  const typeRoots = [join(cliRoot, "node_modules", "@types")];
  const tmpConfig = join(scannerRoot, "tsconfig.vendor-build.json");
  writeFileSync(
    tmpConfig,
    JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: { types: ["node"], typeRoots },
      include: ["src"],
    }),
  );
  try {
    console.log(`[ensure-scanner] building scanner in ${scannerRoot}`);
    execFileSync(process.execPath, [tsc, "-p", tmpConfig], { cwd: scannerRoot, stdio: "inherit" });
  } finally {
    rmSync(tmpConfig, { force: true });
  }
}

main();
