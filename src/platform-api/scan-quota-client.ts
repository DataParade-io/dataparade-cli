import { getDataparadeApiBaseUrl } from "./dataparade-api-base-url";
import { readCliApiErrorMessage } from "./read-cli-api-error-message";

/** Thrown when preflight/complete is rejected with HTTP 403 scan_quota_exceeded. */
export class CliScanQuotaExceededError extends Error {
  readonly code = "scan_quota_exceeded" as const;

  constructor(message: string) {
    super(message);
    this.name = "CliScanQuotaExceededError";
  }
}

/** Thrown when preflight is rejected with HTTP 409 scan_already_running. */
export class CliScanAlreadyRunningError extends Error {
  readonly code = "scan_already_running" as const;

  constructor(message: string) {
    super(message);
    this.name = "CliScanAlreadyRunningError";
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
    const fallback = `Scan preflight failed (${res.status})`;
    let code: string | undefined;
    let message = fallback;
    try {
      const body = await res.json();
      const parsed = readCliApiErrorMessage(body, fallback);
      code = parsed.code;
      message = parsed.message;
    } catch {
      // ignore
    }
    if (res.status === 403 && code === "scan_quota_exceeded") {
      throw new CliScanQuotaExceededError(message);
    }
    if (res.status === 409 && code === "scan_already_running") {
      throw new CliScanAlreadyRunningError(message);
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
    const fallback = `Scan complete report failed (${res.status})`;
    let message = fallback;
    try {
      const body = await res.json();
      message = readCliApiErrorMessage(body, fallback).message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
}
