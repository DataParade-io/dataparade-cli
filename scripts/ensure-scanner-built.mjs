import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

function resolveScannerRoot() {
  const scannerMain = require.resolve("@dataparade/scanner");
  return join(dirname(scannerMain), "..", "..");
}

function main() {
  const scannerRoot = resolveScannerRoot();
  const distMain = join(scannerRoot, "dist", "src", "index.js");
  if (existsSync(distMain)) {
    return;
  }

  execSync("pnpm run build", {
    cwd: scannerRoot,
    stdio: "inherit",
  });
}

main();
