export type CliUploadPreviewResponse = {
  draftId: string;
  projectName?: string | null;
};

export type CliAnonymousUploadPreviewResponse = {
  claimToken: string;
  expiresAt: string;
  projectName: string;
};

export type CliUploadPreviewInput = {
  apiKey?: string;
  dataflow: unknown;
  projectName?: string;
  scanJobId?: string;
  cliUsageSessionId?: string;
  command?: "scan" | "upload";
};
