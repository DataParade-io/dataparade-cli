import { getDataparadeApiBaseUrl } from "./dataparade-api-base-url";
import type {
  CliUploadPreviewInput,
  CliUploadPreviewResponse,
} from "./upload.types";

export type { CliUploadPreviewInput, CliUploadPreviewResponse } from "./upload.types";

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

export async function cliUploadPreview(
  input: CliUploadPreviewInput,
): Promise<CliUploadPreviewResponse> {
  const res = await fetch(`${getDataparadeApiBaseUrl()}/api/scans/cli/upload`, {
    method: "POST",
    headers: buildHeaders(input.apiKey),
    body: JSON.stringify({
      dataflow: input.dataflow,
      projectName: input.projectName,
      scanJobId: input.scanJobId,
    }),
  });

  if (!res.ok) {
    let message = `Upload failed (${res.status})`;
    try {
      const body = (await res.json()) as {
        message?: string | string[];
        error?: string;
      };
      if (typeof body.message === "string") message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join(", ");
      else if (typeof body.error === "string") message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return (await res.json()) as CliUploadPreviewResponse;
}
