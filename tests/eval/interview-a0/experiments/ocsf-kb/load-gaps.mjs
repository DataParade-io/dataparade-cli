/**
 * Load gap report JSON by calling write-gap-report via tsx (no duplicate gap logic).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const experimentDir = path.dirname(fileURLToPath(import.meta.url));
const gapReportPath = path.join(experimentDir, "gap-report.json");
const writeScript = path.join(experimentDir, "write-gap-report.ts");
const repoRoot = path.resolve(experimentDir, "../../../../..");

export function ensureGapReport(env = process.env) {
  const result = spawnSync("pnpm", ["exec", "tsx", writeScript], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `write-gap-report failed: ${result.stderr || result.stdout || result.status}`,
    );
  }
  return JSON.parse(fs.readFileSync(gapReportPath, "utf8"));
}
