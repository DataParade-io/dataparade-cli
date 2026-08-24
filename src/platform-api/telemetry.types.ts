export type CliUsageEventName =
  | "scan_started"
  | "scan_succeeded"
  | "scan_failed"
  | "upload_succeeded"
  | "upload_failed"
  | "preview_opened";

export type ReportCliUsageEventInput = {
  sessionId: string;
  event: CliUsageEventName;
  command?: "scan" | "upload";
  hasApiKey?: boolean;
  apiKey?: string;
  cliVersion?: string;
  draftId?: string;
  errorCode?: string;
  errorMessage?: string;
  source?: "cli" | "web";
};
