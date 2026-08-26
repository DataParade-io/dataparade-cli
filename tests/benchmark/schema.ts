/** Ground-truth benchmark corpus types — mirrors ground-truth-schema.md */

export type ReviewState =
  | "proposed"
  | "accepted"
  | "rejected"
  | "needs_adjudication";

export type AnnotationStatus = "positive" | "negative" | "ambiguous";

export type BenchmarkLayer =
  | "components"
  | "data_flows"
  | "pii_signals"
  | "data_items";

export interface ScopeExclude {
  path: string;
  reason: string;
}

export interface BenchmarkManifest {
  repository: string;
  commit: string;
  license: string;
  scope: {
    include: string[];
    exclude?: ScopeExclude[];
  };
  coverage: {
    layers: BenchmarkLayer[];
    languages: string[];
    domains: string[];
  };
  selection_rationale: string;
  annotation_version: number;
}

export interface AnnotationSubject {
  key: string;
  name?: string;
}

export interface AnnotationEvidence {
  file_path: string;
  start_line: number;
  end_line: number;
}

export interface AnnotationExpected {
  status: AnnotationStatus;
  labels: string[];
}

export interface AnnotationProvenance {
  proposed_by: string;
  proposed_at: string;
  reviewed_by?: string;
  reviewed_at?: string;
  review_state: ReviewState;
}

export interface AnnotationRecord {
  id: string;
  layer: BenchmarkLayer;
  subject: AnnotationSubject;
  evidence: AnnotationEvidence;
  rationale: string;
  expected: AnnotationExpected;
  provenance: AnnotationProvenance;
}

export interface AnnotationFile {
  annotations: AnnotationRecord[];
}

export const REVIEW_STATES: readonly ReviewState[] = [
  "proposed",
  "accepted",
  "rejected",
  "needs_adjudication",
];

export const ANNOTATION_STATUSES: readonly AnnotationStatus[] = [
  "positive",
  "negative",
  "ambiguous",
];

export const BENCHMARK_LAYERS: readonly BenchmarkLayer[] = [
  "components",
  "data_flows",
  "pii_signals",
  "data_items",
];
