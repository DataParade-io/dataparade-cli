/** A0 data-flow interview eval types — DATAP-672 */

/** Six fail-any rubric lines from score-rubric.md (DATAP-671). */
export type RubricLine =
  | "re_ask_known"
  | "refuse_vs_invent"
  | "no_mush_merge"
  | "taxonomy_discipline"
  | "edge_mode"
  | "provenance";

export type Provenance = "scan" | "interview" | "cloud" | "doc";

export type InterviewActionKind = "ask" | "write" | "refuse";

/** Slot keys aligned with dogfood-brief-a0.md required slots. */
export type InterviewSlot =
  | "system_identity"
  | "system_boundary"
  | "actors"
  | "external_systems"
  | "sends_data_to.endpoint"
  | "sends_data_to.data_categories"
  | "sends_data_to.purpose"
  | "interacts_with"
  | "deploy_topology"
  | "container_box";

export interface InterviewAction {
  kind: InterviewActionKind;
  slot: InterviewSlot;
  /** Discovery id when the action targets a specific cmp_* or flow_* row. */
  discoveryId?: string;
  value?: string | string[];
  provenance?: Provenance;
  /** Human-readable question or answer text (audit trail). */
  text?: string;
}

export interface SimulatedInterview {
  id: string;
  description: string;
  actions: InterviewAction[];
}

export interface BriefManifest {
  repository: string;
  brief_path: string;
  commit: string;
  skill_path: string;
  skill_commit: string;
}

export interface BriefSnapshot {
  sha: string;
  scanKnownComponents: string[];
  scanKnownFlows: string[];
  partialKnownActors: string[];
  unknownSlots: InterviewSlot[];
  siblingRepoCandidates: string[];
  taxonomy: {
    dataCategories: string[];
    purposes: string[];
    actorKinds: string[];
  };
  /** Component ids sharing a display name (mush-merge candidates). */
  mushMergeGroups: Record<string, string[]>;
}

export interface RubricViolation {
  line: RubricLine;
  actionIndex: number;
  message: string;
}

export interface InterviewScoreReport {
  interviewId: string;
  briefSha: string;
  passed: boolean;
  violations: RubricViolation[];
}

export interface InterviewEvalCase {
  id: string;
  interview: SimulatedInterview;
  /** Empty = expect pass; non-empty = expect exactly these rubric lines to fail. */
  expectedViolations: RubricLine[];
  rationale: string;
}
