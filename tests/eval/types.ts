/** Fixture evaluation types — aligns with tests/benchmark/schema.ts and ground-truth-schema.md */

export type EvalCaseStatus = "positive" | "negative" | "ambiguous";

export type EvalLayer = "components" | "data-flows" | "pii-signals" | "data-items";

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
   * Marks a known scanner miss for reporting. Still counted in recall metrics;
   * CI gating excludes documented gaps separately.
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
  /** Null when there are no evaluable (read) positive cases */
  recall: number | null;
  /** Null when no positives matched */
  labelAccuracy: number | null;
  /** Null when there are no evaluable (read) positive cases */
  correctLabelRecall: number | null;
  /** Null when no exhaustive scope produced scoped findings */
  precision: number | null;
  /** Null when there are no evaluable (read) negative cases */
  negativeCasePassRate: number | null;
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
