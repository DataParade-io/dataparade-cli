import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

import type { Command } from "commander";

import { ComparisonRefused } from "@dataparade/kb-compare";

import { resolveWorkspaceApiKey } from "../config/scan-env";
import { defaultCacheDir, DiffError, runDiff, type ScanFn, type ToolStamps } from "./run-diff";
import { describeUploadedComparison, uploadDiffScans } from "./upload-diff";

/** Scans a folder by running this CLI's own `scan` command, with AI off and no upload. */
function scanWithThisCli(): ScanFn {
  const entry = process.argv[1];
  return (dir, outDir) => {
    try {
      execFileSync(process.execPath, [entry, "scan", dir, "--no-ai-inference", "-o", path.join(outDir, "dataflow.json")], {
        env: { ...process.env, DATAPARADE_SKIP_AUTO_UPLOAD: "1", SCAN_AI_INFERENCE: "false" },
        stdio: ["ignore", "ignore", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
      return JSON.parse(fs.readFileSync(path.join(outDir, "facts.json"), "utf8"));
    } catch (error) {
      const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
      throw new DiffError("SCAN_FAILED", `The scan of ${dir} failed${stderr ? `:\n${stderr.split("\n").slice(-5).join("\n")}` : "."}`);
    }
  };
}

interface DiffCommandOptions {
  output: string;
  cache: boolean;
  upload?: boolean;
  workspaceApiKey?: string;
}

/** Hidden for now (DATAP-852): compares two Git revisions of one repository. */
export function registerDiffCommand(program: Command, tools: () => ToolStamps): void {
  program
    .command("diff <repo> <base> <head>", { hidden: true })
    .description("Compare two Git revisions of a repository and write the change set (AI off)")
    .option("-o, --output <dir>", "Folder for change-set.json, summary.txt and renames.json", "dataparade-diff")
    .option("--no-cache", "Scan both revisions again instead of reusing cached scans")
    .option("--upload", "Upload both scans, the rename map and the root commit, so the backend compares them (needs a workspace API key)")
    .option("--workspace-api-key <key>", "DataParade workspace API key for --upload (env: DATAPARADE_WORKSPACE_API_KEY)")
    .action(async (repo: string, base: string, head: string, options: DiffCommandOptions) => {
      const apiKey = options.workspaceApiKey?.trim() || resolveWorkspaceApiKey(process.env);
      if (options.upload && !apiKey) {
        console.error("--upload needs a workspace API key: pass --workspace-api-key or set DATAPARADE_WORKSPACE_API_KEY.");
        process.exitCode = 1;
        return;
      }
      try {
        const result = runDiff({
          repo,
          base,
          head,
          outputDir: path.resolve(options.output),
          scan: scanWithThisCli(),
          tools: tools(),
          cacheDir: options.cache ? defaultCacheDir() : null,
          keepScans: Boolean(options.upload),
          log: (line) => console.error(line),
        });
        console.log(`${result.baseSha.slice(0, 8)}..${result.headSha.slice(0, 8)}`);
        console.log(result.summary);
        console.log(`\nWrote ${result.files.changeSet}`);
        if (options.upload) {
          const uploaded = await uploadDiffScans({ apiKey: apiKey!, repo, result, log: (line) => console.error(line) });
          console.log(describeUploadedComparison(uploaded));
        }
      } catch (error) {
        if (error instanceof ComparisonRefused) {
          // DATAP-877: the two scans cannot be compared; say why, with the reason code.
          console.error(`Cannot compare these scans (${error.reason}): ${error.message}`);
          process.exitCode = 3;
          return;
        }
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = error instanceof DiffError && error.code === "DIRTY_TREE" ? 2 : 1;
      }
    });
}
