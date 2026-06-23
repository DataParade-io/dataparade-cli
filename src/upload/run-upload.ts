import { cliUploadPreview } from "../platform-api/upload-client";
import { buildImportPreviewUrl } from "./build-preview-url";
import type { RunDataflowUploadInput, RunDataflowUploadResult } from "./types";

export async function runDataflowUpload(
  input: RunDataflowUploadInput,
): Promise<RunDataflowUploadResult> {
  const prefix = input.logPrefix ?? "[upload]";
  const result = await cliUploadPreview({
    apiKey: input.apiKey,
    dataflow: input.dataflow,
    projectName: input.projectName,
    scanJobId: input.scanJobId,
  });
  const previewUrl = buildImportPreviewUrl(result.draftId);
  // eslint-disable-next-line no-console
  console.log(`${prefix} Preview ready: ${previewUrl}`);
  return { draftId: result.draftId, previewUrl };
}
