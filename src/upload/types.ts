export type RunDataflowUploadInput = {
  apiKey?: string;
  dataflow: unknown;
  projectName?: string;
  scanJobId?: string;
  logPrefix?: string;
  cliUsageSessionId?: string;
  command?: "scan" | "upload";
};

export type RunDataflowUploadResult = {
  draftId?: string;
  previewUrl: string;
};
