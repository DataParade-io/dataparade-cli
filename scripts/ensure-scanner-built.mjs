import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scannerRoot = path.join(root, "node_modules", "@dataparade", "scanner");
const distEntry = path.join(scannerRoot, "dist", "src", "index.js");

if (!existsSync(distEntry) && existsSync(path.join(scannerRoot, "package.json"))) {
  if (!existsSync(path.join(scannerRoot, "node_modules"))) {
    execSync("pnpm install --ignore-workspace", {
      cwd: scannerRoot,
      stdio: "inherit",
      env: { ...process.env, CI: "true" },
    });
  }
  execSync("pnpm run build", { cwd: scannerRoot, stdio: "inherit" });
}
