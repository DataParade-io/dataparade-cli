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
  command?: 'scan' | 'upload';
  graphifyGraph?: unknown;
  dataparadeGraph?: unknown;
  facts?: unknown[];
  /** Written beside dataflow.json. Sent in later requests, not this body. */
  files?: Array<{ relativePath: string; content: string }>;
};
