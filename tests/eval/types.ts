export interface EvidenceRef {
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface ReportedFinding {
  identity: string;
  name: string;
  labels: string[];
  evidence: EvidenceRef[];
}

export type GroundTruthStatus = "positive" | "negative" | "ambiguous";

export interface GroundTruthCase {
  id: string;
  layer: string;
  subject: {
    key: string;
    name?: string;
  };
  evidence: EvidenceRef;
  expected: {
    status: GroundTruthStatus;
    labels: string[];
  };
  scopeId?: string;
}

export interface ExhaustiveScope {
  id: string;
  filePaths: string[];
}

export interface ScoredFileCoverage {
  filePath: string;
  scanned: boolean;
}

export interface LayerScoreCounts {
  TP: number;
  FP: number;
  FN: number;
  TN: number;
  matchedPositives: number;
  labelMatches: number;
  evaluablePositives: number;
  negativeCases: number;
  negativePasses: number;
}

export interface LayerScoreResult {
  recall: number | null;
  labelAccuracy: number | null;
  correctLabelRecall: number | null;
  precision: number | null;
  negativeCasePassRate: number | null;
  unreadCount: number;
  counts: LayerScoreCounts;
}
