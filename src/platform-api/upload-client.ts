import { packScanUploadRequests } from '../upload/pack-scan-upload';
import type { ScanUploadFile } from '../upload/collect-scan-sidecars';
import { getDataparadeApiBaseUrl } from './dataparade-api-base-url';
import type {
  CliAnonymousUploadPreviewResponse,
  CliUploadCompareRequest,
  CliUploadCompleteResponse,
  CliUploadPreviewInput,
  CliUploadPreviewResponse,
} from './upload.types';

export type {
  CliAnonymousUploadPreviewResponse,
  CliUploadComparison,
  CliUploadCompareRequest,
  CliUploadCompleteResponse,
  CliUploadPreviewInput,
  CliUploadPreviewResponse,
} from './upload.types';

function buildAuthHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

/** Upload rejected by the API; `status` is the HTTP status (429 = rate limit). */
export class CliUploadError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'CliUploadError';
  }
}

async function parseUploadError(res: Response): Promise<never> {
  let message = `Upload failed (${res.status})`;
  try {
    const body = (await res.json()) as {
      message?: string | string[];
      error?: string;
    };
    if (typeof body.message === 'string') message = body.message;
    else if (Array.isArray(body.message)) message = body.message.join(', ');
    else if (typeof body.error === 'string') message = body.error;
  } catch {
    // ignore
  }
  throw new CliUploadError(message, res.status);
}

export async function cliUploadAnonymousPreview(input: {
  dataflow: unknown;
  projectName?: string;
  scanJobId?: string;
  cliUsageSessionId?: string;
  command?: 'scan' | 'upload';
  graphifyGraph?: unknown;
  dataparadeGraph?: unknown;
  facts?: unknown[];
  files?: ScanUploadFile[];
}): Promise<CliAnonymousUploadPreviewResponse> {
  const res = await fetch(
    `${getDataparadeApiBaseUrl()}/api/scans/cli/preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataflow: input.dataflow,
        projectName: input.projectName,
        scanJobId: input.scanJobId,
        cliUsageSessionId: input.cliUsageSessionId,
        command: input.command,
        graphifyGraph: input.graphifyGraph,
        dataparadeGraph: input.dataparadeGraph,
        facts: input.facts,
      }),
    }
  );

  if (!res.ok) {
    return await parseUploadError(res);
  }

  const created = (await res.json()) as CliAnonymousUploadPreviewResponse;
  if (input.files && input.files.length > 0) {
    await postScanFiles(
      `${getDataparadeApiBaseUrl()}/api/scans/cli/preview/files`,
      { 'Content-Type': 'application/json' },
      input.files,
      created.claimToken
    );
  }
  return created;
}

async function postScanFiles(
  url: string,
  headers: Record<string, string>,
  files: ScanUploadFile[],
  claimToken?: string
): Promise<void> {
  const requests = packScanUploadRequests(files);
  for (const request of requests) {
    const body = claimToken ? { claimToken, ...request } : request;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return await parseUploadError(res);
    }
  }
}

export async function cliUploadPreview(
  input: CliUploadPreviewInput & { apiKey: string }
): Promise<CliUploadPreviewResponse> {
  const res = await fetch(`${getDataparadeApiBaseUrl()}/api/scans/cli/upload`, {
    method: 'POST',
    headers: buildAuthHeaders(input.apiKey),
    body: JSON.stringify({
      dataflow: input.dataflow,
      projectName: input.projectName,
      scanJobId: input.scanJobId,
      cliUsageSessionId: input.cliUsageSessionId,
      command: input.command,
      graphifyGraph: input.graphifyGraph,
      dataparadeGraph: input.dataparadeGraph,
      facts: input.facts,
    }),
  });

  if (!res.ok) {
    return await parseUploadError(res);
  }

  const created = (await res.json()) as CliUploadPreviewResponse;
  if (input.files && input.files.length > 0) {
    const draftUrl = `${getDataparadeApiBaseUrl()}/api/scans/cli/upload/${encodeURIComponent(created.draftId)}`;
    await postScanFiles(
      `${draftUrl}/files`,
      buildAuthHeaders(input.apiKey),
      input.files
    );
    const complete = await completeScanUpload(
      draftUrl,
      input.apiKey,
      input.remoteUrl ?? null,
      input.compare
    );
    return { ...created, complete };
  }
  return created;
}

/**
 * Tells the backend the scan files are all uploaded, so it stores the scan in the
 * knowledge base (DATAP-883). With `compare` (`diff --upload` head, DATAP-890) the
 * backend also stores the rename map and compares the head with the base. The
 * preview works without it, so a failure only warns and gives null.
 */
async function completeScanUpload(
  draftUrl: string,
  apiKey: string,
  remoteUrl: string | null,
  compare?: CliUploadCompareRequest
): Promise<CliUploadCompleteResponse | null> {
  try {
    const res = await fetch(`${draftUrl}/complete`, {
      method: 'POST',
      headers: buildAuthHeaders(apiKey),
      body: JSON.stringify({
        ...(remoteUrl ? { remoteUrl } : {}),
        ...(compare ? { compare } : {}),
      }),
    });
    if (!res.ok) {
      console.warn(
        `[upload] warning: the scan was uploaded but not stored for comparison (${res.status}).`
      );
      return null;
    }
    return (await res.json()) as CliUploadCompleteResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[upload] warning: the scan was uploaded but not stored for comparison: ${message}`
    );
    return null;
  }
}
