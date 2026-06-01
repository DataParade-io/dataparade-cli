import * as Sentry from "@sentry/node";

/** Same project as backend; override with SENTRY_DSN or disable with SCAN_SENTRY_ENABLED=false. */
const DEFAULT_SENTRY_DSN =
  "https://f0f0617fca41c8c537c50553fb9a8eac@o4510835264192512.ingest.us.sentry.io/4510835291455488";

export type ScanCliAiMode = "byok" | "platform" | "none";

export type ReportScanCliErrorInput = {
  error: unknown;
  scanRoot?: string;
  jobId?: string;
  aiMode?: ScanCliAiMode;
  aiProvider?: string;
  failurePhase?: string;
  failureCode?: string;
  extra?: Record<string, unknown>;
};

let initialized = false;
let enabled = false;

function resolveDsn(): string | undefined {
  const explicitOff =
    process.env.SCAN_SENTRY_ENABLED?.trim().toLowerCase() === "false";
  if (explicitOff) return undefined;

  const fromEnv = process.env.SENTRY_DSN?.trim();
  if (fromEnv === "" || fromEnv?.toLowerCase() === "false") return undefined;
  if (fromEnv) return fromEnv;

  if (process.env.NODE_ENV === "test") return undefined;

  return DEFAULT_SENTRY_DSN;
}

function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;

  const dsn = resolveDsn();
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT?.trim() ||
      process.env.NODE_ENV ||
      "cli",
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
  enabled = true;
}

function toError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string" && error.trim()) return new Error(error.trim());
  return new Error(fallbackMessage);
}

/**
 * Report a CLI scan failure to Sentry (BYOK, platform, or structural-only).
 * No-op when Sentry is disabled. Never throws.
 */
export async function reportScanCliError(
  input: ReportScanCliErrorInput,
): Promise<void> {
  try {
    ensureInitialized();
    if (!enabled) return;

    const err = toError(input.error, "CLI scan failed");

    Sentry.withScope((scope) => {
      scope.setTag("scan_process", "true");
      scope.setTag("scan_error_source", "cli");
      if (input.aiMode) scope.setTag("ai_mode", input.aiMode);
      if (input.aiProvider) scope.setTag("ai_provider", input.aiProvider);
      if (input.jobId) scope.setTag("scan_job_id", input.jobId);
      if (input.failurePhase) scope.setTag("failure_phase", input.failurePhase);
      if (input.failureCode) scope.setTag("failure_code", input.failureCode);
      if (input.scanRoot) scope.setExtra("scanRoot", input.scanRoot);
      if (input.extra) scope.setExtras(input.extra);
      Sentry.captureException(err);
    });

    await Sentry.flush(2000);
  } catch (reportErr) {
    const detail =
      reportErr instanceof Error ? reportErr.message : String(reportErr);
    // eslint-disable-next-line no-console
    console.warn(`[scan] failed to report error to Sentry: ${detail}`);
  }
}

/** Flush pending Sentry events before process exit. */
export async function flushCliSentry(): Promise<void> {
  if (!enabled) return;
  try {
    await Sentry.flush(2000);
  } catch {
    // ignore
  }
}

/** @internal tests */
export function resetCliSentryForTests(): void {
  initialized = false;
  enabled = false;
}
