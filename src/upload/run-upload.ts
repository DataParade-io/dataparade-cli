import {
  cliUploadAnonymousPreview,
  cliUploadPreview,
} from "../platform-api/upload-client";
import { reportCliUsageEvent } from "../platform-api/telemetry-client";
import {
  buildAnonymousCliPreviewUrl,
  buildImportPreviewUrl,
} from "./build-preview-url";
import type { RunDataflowUploadInput, RunDataflowUploadResult } from "./types";

export async function runDataflowUpload(
  input: RunDataflowUploadInput,
): Promise<RunDataflowUploadResult> {
  const prefix = input.logPrefix ?? "[upload]";
  const command = input.command ?? "scan";
  const sessionId = input.cliUsageSessionId?.trim();
  const apiKey = input.apiKey?.trim();

  try {
    if (apiKey) {
      const result = await cliUploadPreview({
        apiKey,
        dataflow: input.dataflow,
        projectName: input.projectName,
        scanJobId: input.scanJobId,
        cliUsageSessionId: sessionId,
        command,
      });
      const previewUrl = buildImportPreviewUrl(result.draftId, sessionId);
      // eslint-disable-next-line no-console
      console.log(`${prefix} Preview ready: ${previewUrl}`);
      if (sessionId) {
        await reportCliUsageEvent({
          sessionId,
          event: "upload_succeeded",
          command,
          hasApiKey: true,
          apiKey,
          draftId: result.draftId,
        });
      }
      return { draftId: result.draftId, previewUrl };
    }

    const result = await cliUploadAnonymousPreview({
      dataflow: input.dataflow,
      projectName: input.projectName,
      scanJobId: input.scanJobId,
      cliUsageSessionId: sessionId,
      command,
    });
    const previewUrl = buildAnonymousCliPreviewUrl(result.claimToken, sessionId);
    // eslint-disable-next-line no-console
    console.log(`${prefix} Preview ready: ${previewUrl}`);
    // eslint-disable-next-line no-console
    console.log(
      `${prefix} Claiming this preview after signup uses 1 scan slot` +
        (input.scanJobId
          ? " and any platform AI tokens used during the scan."
          : "."),
    );
    if (sessionId) {
      await reportCliUsageEvent({
        sessionId,
        event: "upload_succeeded",
        command,
        hasApiKey: false,
      });
    }
    return { previewUrl };
  } catch (error) {
    if (sessionId) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      await reportCliUsageEvent({
        sessionId,
        event: "upload_failed",
        command,
        hasApiKey: Boolean(apiKey),
        apiKey,
        errorCode: "upload_failed",
        errorMessage: message,
      });
    }
    throw error;
  }
}
