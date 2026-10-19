export type RunDataflowUploadInput = {
  apiKey?: string;
  dataflow: unknown;
  projectName?: string;
  scanJobId?: string;
  logPrefix?: string;
  cliUsageSessionId?: string;
  command?: 'scan' | 'upload';
  graphifyGraph?: unknown;
  dataparadeGraph?: unknown;
  facts?: unknown[];
  /** Scan files uploaded in their own requests, not inside the diagram body. */
  files?: Array<{ relativePath: string; content: string }>;
  /** Skip the `[prefix] Preview ready` lines (TTY scan renders its own block). */
  quiet?: boolean;
};

export type RunDataflowUploadResult = {
  draftId?: string;
  previewUrl: string;
  /** Extra human hint shown with the preview (anonymous claim cost). */
  notice?: string;
};
