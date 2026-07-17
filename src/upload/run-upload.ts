import {
  cliUploadAnonymousPreview,
  cliUploadPreview,
} from "../platform-api/upload-client";
import {
  buildAnonymousCliPreviewUrl,
  buildImportPreviewUrl,
} from "./build-preview-url";
import type { RunDataflowUploadInput, RunDataflowUploadResult } from "./types";

export async function runDataflowUpload(
  input: RunDataflowUploadInput,
): Promise<RunDataflowUploadResult> {
  const prefix = input.logPrefix ?? "[upload]";

  if (input.apiKey?.trim()) {
    const result = await cliUploadPreview({
      apiKey: input.apiKey.trim(),
      dataflow: input.dataflow,
      projectName: input.projectName,
      scanJobId: input.scanJobId,
    });
    const previewUrl = buildImportPreviewUrl(result.draftId);
    // eslint-disable-next-line no-console
    console.log(`${prefix} Preview ready: ${previewUrl}`);
    return { draftId: result.draftId, previewUrl };
  }

  const result = await cliUploadAnonymousPreview({
    dataflow: input.dataflow,
    projectName: input.projectName,
    scanJobId: input.scanJobId,
  });
  const previewUrl = buildAnonymousCliPreviewUrl(result.claimToken);
  // eslint-disable-next-line no-console
  console.log(`${prefix} Preview ready: ${previewUrl}`);
  // eslint-disable-next-line no-console
  console.log(
    `${prefix} Claiming this preview after signup uses 1 scan slot` +
      (input.scanJobId
        ? " and any platform AI tokens used during the scan."
        : "."),
  );
  return { previewUrl };
}
