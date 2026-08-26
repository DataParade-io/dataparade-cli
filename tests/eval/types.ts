/** Fixture evaluation types — aligns with tests/benchmark/schema.ts and ground-truth-schema.md */

export type EvalCaseStatus = "positive" | "negative" | "ambiguous";

export type EvalLayer = "components";

export interface EvalSubject {
  /** Layer identity, e.g. `asset:database` or `third_party:stripe` */
  key: string;
  name?: string;
}

export interface EvalEvidence {
  file_path: string;
  start_line: number;
  end_line: number;
}

export interface EvalExpected {
  status: EvalCaseStatus;
  labels: string[];
  /**
   * Positive ground truth excluded from recall denominators until the scanner
   * is expected to pass. Documented gaps still appear in reports.
   */
  documentedGap?: boolean;
}

export interface EvalCase {
  id: string;
  fixture: string;
  layer: EvalLayer;
  subject: EvalSubject;
  evidence: EvalEvidence;
  expected: EvalExpected;
  rationale: string;
  /**
   * Files exhaustively reviewed for this fixture. When set, scanner findings
   * with source locations in these files contribute to precision.
   */
  exhaustiveScopeFiles?: string[];
}

export interface LayerFinding {
  key: string;
  labels: string[];
  sourceFilePaths: string[];
  sourceLines: Array<{
    file_path: string;
    start_line: number;
    end_line: number;
  }>;
}

export interface FixtureScanResult {
  fixture: string;
  findings: LayerFinding[];
  scannedFiles: string[];
}

export interface EvalScoreDenominators {
  evaluablePositives: number;
  matchedPositives: number;
  matchedWithCorrectLabels: number;
  negativeCases: number;
  negativeCasesPassed: number;
  exhaustiveScopedFindings: number;
  exhaustiveScopedMatches: number;
}

export interface EvalScores {
  recall: number;
  labelAccuracy: number;
  correctLabelRecall: number;
  /** Null when no exhaustive scope produced scoped findings */
  precision: number | null;
  negativeCasePassRate: number;
  unreadCount: number;
  denominators: EvalScoreDenominators;
}

export interface EvalCaseResult {
  caseId: string;
  fixture: string;
  unread: boolean;
  matched: boolean;
  labelsCorrect: boolean;
  negativeClean: boolean;
  documentedGap: boolean;
}

export interface EvalScoreReport {
  scores: EvalScores;
  caseResults: EvalCaseResult[];
}
