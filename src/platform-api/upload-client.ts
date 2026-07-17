import { getDataparadeApiBaseUrl } from "./dataparade-api-base-url";
import type {
  CliAnonymousUploadPreviewResponse,
  CliUploadPreviewInput,
  CliUploadPreviewResponse,
} from "./upload.types";

export type {
  CliAnonymousUploadPreviewResponse,
  CliUploadPreviewInput,
  CliUploadPreviewResponse,
} from "./upload.types";

function buildAuthHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function parseUploadError(res: Response): Promise<never> {
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

export async function cliUploadAnonymousPreview(input: {
  dataflow: unknown;
  projectName?: string;
  scanJobId?: string;
}): Promise<CliAnonymousUploadPreviewResponse> {
  const res = await fetch(
    `${getDataparadeApiBaseUrl()}/api/scans/cli/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataflow: input.dataflow,
        projectName: input.projectName,
        scanJobId: input.scanJobId,
      }),
    },
  );

  if (!res.ok) {
    return await parseUploadError(res);
  }

  return (await res.json()) as CliAnonymousUploadPreviewResponse;
}

export async function cliUploadPreview(
  input: CliUploadPreviewInput & { apiKey: string },
): Promise<CliUploadPreviewResponse> {
  const res = await fetch(`${getDataparadeApiBaseUrl()}/api/scans/cli/upload`, {
    method: "POST",
    headers: buildAuthHeaders(input.apiKey),
    body: JSON.stringify({
      dataflow: input.dataflow,
      projectName: input.projectName,
      scanJobId: input.scanJobId,
    }),
  });

  if (!res.ok) {
    return await parseUploadError(res);
  }

  return (await res.json()) as CliUploadPreviewResponse;
}
