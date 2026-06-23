export type CliUploadPreviewInput = {
  apiKey: string;
  dataflow: unknown;
  projectName?: string;
  scanJobId?: string;
};

export type CliUploadPreviewResponse = {
  draftId: string;
  projectName?: string | null;
};
