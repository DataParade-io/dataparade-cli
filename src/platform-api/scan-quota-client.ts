import { getDataparadeApiBaseUrl } from "./dataparade-api-base-url";

/** Thrown when preflight/complete is rejected with HTTP 403 scan_quota_exceeded. */
export class CliScanQuotaExceededError extends Error {
  readonly code = "scan_quota_exceeded" as const;

  constructor(message: string) {
    super(message);
    this.name = "CliScanQuotaExceededError";
  }
}

export type CliScanPreflightResponse = {
  allowed: boolean;
  jobId: string;
  scansRemaining: number;
  aiTokensRemaining: number;
  suggestedAiBudgetTokens: number;
  aiDelivery?: 'platform_proxy' | 'none';
};

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

export async function cliScanPreflight(input: {
  apiKey: string;
  enableAi?: boolean;
  projectName?: string;
  fileCount?: number;
  bytesIngested?: number;
}): Promise<CliScanPreflightResponse> {
  const res = await fetch(`${getDataparadeApiBaseUrl()}/api/scans/cli/preflight`, {
    method: "POST",
    headers: buildHeaders(input.apiKey),
    body: JSON.stringify({
      enableAi: input.enableAi,
      projectName: input.projectName,
      fileCount: input.fileCount,
      bytesIngested: input.bytesIngested,
    }),
  });

  if (!res.ok) {
    let message = `Scan preflight failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { message?: string | string[]; code?: string };
      code = body.code;
      if (typeof body.message === "string") message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join(", ");
    } catch {
      // ignore
    }
    if (res.status === 403 && code === "scan_quota_exceeded") {
      throw new CliScanQuotaExceededError(message);
    }
    throw new Error(message);
  }

  return (await res.json()) as CliScanPreflightResponse;
}

export async function cliScanComplete(input: {
  apiKey: string;
  jobId: string;
  status: "completed" | "failed";
  aiTokensUsed?: number;
  failureCode?: string;
  failureMessage?: string;
}): Promise<void> {
  const res = await fetch(
    `${getDataparadeApiBaseUrl()}/api/scans/cli/${encodeURIComponent(input.jobId)}/complete`,
    {
      method: "POST",
      headers: buildHeaders(input.apiKey),
      body: JSON.stringify({
        status: input.status,
        aiTokensUsed: input.aiTokensUsed,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
      }),
    },
  );

  if (!res.ok) {
    let message = `Scan complete report failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (typeof body.message === "string") message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join(", ");
    } catch {
      // ignore
    }
    throw new Error(message);
  }
}
