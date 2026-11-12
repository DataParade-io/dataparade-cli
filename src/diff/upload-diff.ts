import fs from "fs";
import path from "path";

import { cliUploadPreview, type CliUploadComparison, type CliUploadPreviewResponse } from "../platform-api/upload-client";
import { readOriginRemoteUrl } from "../output/git-context";
import { collectScanUploadFiles } from "../upload/collect-scan-sidecars";
import type { RunDiffResult } from "./run-diff";

/**
 * `dataparade diff --upload` (DATAP-886, DATAP-890): uploads the base and head scans of a diff
 * through the normal upload path, so the backend stores a comparable pair. The head's completion
 * call carries the rename map and root commit; the backend stores the map as renames.json beside
 * the head's facts.json and compares the head with the base (DATAP-891).
 */

export type UploadFn = typeof cliUploadPreview;

export interface UploadDiffOptions {
  apiKey: string;
  /** The scanned repository, for its origin remote. */
  repo: string;
  result: Pick<RunDiffResult, "baseSha" | "headSha" | "rootCommit" | "renames" | "scanDirs">;
  upload?: UploadFn;
  log?: (line: string) => void;
}

export interface UploadDiffResult {
  base: CliUploadPreviewResponse;
  head: CliUploadPreviewResponse;
  /** The backend's comparison of the pair; null when the head completion failed or did not compare. */
  comparison: CliUploadComparison | null;
}

function readDataflow(dir: string): { dataflow: unknown; dataflowPath: string; projectName?: string } {
  const dataflowPath = path.join(dir, "dataflow.json");
  const dataflow: unknown = JSON.parse(fs.readFileSync(dataflowPath, "utf8"));
  const name = (dataflow as { metadata?: { projectName?: unknown } } | null)?.metadata?.projectName;
  return { dataflow, dataflowPath, ...(typeof name === "string" && name.trim() ? { projectName: name.trim() } : {}) };
}

export async function uploadDiffScans(options: UploadDiffOptions): Promise<UploadDiffResult> {
  const { result } = options;
  if (!result.scanDirs) throw new Error("The diff kept no scans to upload; run it with keepScans.");
  const upload = options.upload ?? cliUploadPreview;
  const log = options.log ?? (() => {});
  const remoteUrl = readOriginRemoteUrl(options.repo);

  const send = async (side: "base" | "head", sha: string) => {
    const { dataflow, dataflowPath, projectName } = readDataflow(result.scanDirs![side]);
    log(`Uploading the scan of ${sha.slice(0, 8)} (${side})...`);
    return upload({
      apiKey: options.apiKey,
      dataflow,
      projectName,
      command: "upload",
      files: collectScanUploadFiles(dataflowPath),
      remoteUrl,
      ...(side === "head"
        ? { compare: { baseCommitSha: result.baseSha, rootCommitSha: result.rootCommit, renames: result.renames } }
        : {}),
    });
  };

  // The base first: the head's completion compares with the stored base scan.
  const base = await send("base", result.baseSha);
  const head = await send("head", result.headSha);
  const complete = head.complete;
  const comparison = complete && complete.stored ? (complete.comparison ?? null) : null;
  return { base, head, comparison };
}

/** One line on what the backend did with the pair, for the terminal. */
export function describeUploadedComparison(upload: UploadDiffResult): string {
  for (const [side, response] of [
    ["base", upload.base],
    ["head", upload.head],
  ] as const) {
    if (!response.complete) return `The ${side} scan was uploaded but not stored for comparison.`;
    if (!response.complete.stored) return `The ${side} scan was uploaded but not stored for comparison (${response.complete.reason}).`;
  }
  const comparison = upload.comparison;
  if (!comparison) return "The scans were stored; the backend did not compare them.";
  if (!comparison.compared) return `The backend did not compare the scans (${comparison.reason}): ${comparison.message}`;
  const counts = new Map<string, number>();
  for (const binding of comparison.bindings) counts.set(binding.status, (counts.get(binding.status) ?? 0) + 1);
  const answers = [...counts].map(([status, count]) => `${count} ${status}`).join(", ");
  return `Stored comparison ${comparison.comparison.id}${answers ? ` (answers: ${answers})` : ""}.`;
}
