export type CliUploadPreviewResponse = {
  draftId: string;
  projectName?: string | null;
  /** The web app of the API that took the upload. Older backends leave it out. */
  appUrl?: string;
  /**
   * What `POST upload/:draftId/complete` returned (DATAP-883): the stored scan, and for a
   * `diff --upload` head the comparison with the base. Null when the call failed.
   */
  complete?: CliUploadCompleteResponse | null;
};

/** A comparison the backend ran (DATAP-891), or why it did not. */
export type CliUploadComparison =
  | {
      compared: true;
      created: boolean;
      comparison: { id: string; changeSet: { renames?: string } };
      bindings: Array<{ answerId: string; status: string; reason: string }>;
      summary: string;
    }
  | { compared: false; reason: string; message: string };

export type CliUploadCompleteResponse =
  | {
      stored: true;
      scanId: string;
      repositoryId: string;
      created: boolean;
      comparable: boolean;
      comparison?: CliUploadComparison;
    }
  | { stored: false; reason: string };

/** Sent with the head upload of `dataparade diff --upload` (DATAP-890). */
export type CliUploadCompareRequest = {
  baseCommitSha: string;
  rootCommitSha: string;
  renames: Array<{ from: string; to: string; similarity?: number }>;
};

export type CliAnonymousUploadPreviewResponse = {
  claimToken: string;
  expiresAt: string;
  projectName: string;
  /** The web app of the API that took the upload. Older backends leave it out. */
  appUrl?: string;
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
  /** Normalized origin remote, sent when the upload is completed (DATAP-883). */
  remoteUrl?: string | null;
  /** From `diff --upload` on the head scan: compare it with the base after it is stored. */
  compare?: CliUploadCompareRequest;
};
