export type RunDataflowUploadInput = {
  apiKey: string;
  dataflow: unknown;
  projectName?: string;
  scanJobId?: string;
  logPrefix?: string;
};

export type RunDataflowUploadResult = {
  draftId: string;
  previewUrl: string;
};
