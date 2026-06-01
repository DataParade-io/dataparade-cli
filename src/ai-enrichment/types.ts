import type { ServiceSection } from "../core/sectioning/discover-service-sections";
import type { DetectedComponent } from "../core/types/component";
import type { RawFinding } from "../core/types/detection";
import type { DataFlowType, DetectedDataFlow } from "../core/types/data-flow";
import type { FileInfo } from "../core/types/file";

export type AiCandidateType =
  | "third_party"
  | "node_property"
  | "flow_direction"
  | "missing_interaction";

export type AiAgentName =
  | "tpAgent"
  | "propertyAgent"
  | "directionAgent"
  | "interactionAgent";

/** User-facing inference presets (see `providers/presets.ts`). */
export const AI_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "local",
  "mock",
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** `third_party_only`: after rules, only run AI enrichment for third-party nodes (every one). */
export type AiInferenceScope = "default" | "third_party_only";

export interface AiInferenceCandidate {
  id: string;
  candidateType: AiCandidateType;
  priority: number;
  componentId?: string;
  flowId?: string;
  missingFields: string[];
  rationale: string;
  hints: string[];
}

export interface AiConfidence {
  score: number;
  band: "high" | "medium" | "low";
}

export interface EvidenceRef {
  filePath: string;
  startLine: number;
  endLine: number;
  reason: string;
}

export interface ComponentPatch {
  kind: "component_patch";
  targetComponentId: string;
  candidateType: AiCandidateType;
  setSubType?: string;
  setDescription?: string;
  setProperties: Record<string, unknown>;
  propertyEvidence?: Record<string, EvidenceRef[]>;
  confidence: AiConfidence;
  evidence: EvidenceRef[];
  provider: AiProviderId;
  model: string;
  agent: AiAgentName;
}

export interface FlowPatch {
  kind: "flow_patch";
  candidateType: AiCandidateType;
  targetFlowId?: string;
  insertIfMissing?: boolean;
  sourceComponentId?: string;
  targetComponentId?: string;
  setType?: DataFlowType;
  setDirection?: "forward" | "reverse";
  setMethod?: string;
  setEndpoint?: string;
  setDescription?: string;
  setProperties?: Partial<DetectedDataFlow>;
  confidence: AiConfidence;
  evidence: EvidenceRef[];
  provider: AiProviderId;
  model: string;
  agent: AiAgentName;
}

export type AiProposal = ComponentPatch | FlowPatch;

export interface MergeProvenance {
  source: "rule" | "ai_agent";
  provider?: string;
  model?: string;
  agent?: AiAgentName;
  candidateType?: AiCandidateType;
  confidence: number;
  confidenceBand?: "high" | "medium" | "low";
  evidence: EvidenceRef[];
}

export interface AiMergeResult {
  components: DetectedComponent[];
  dataFlows: DetectedDataFlow[];
  appliedProposalIds: string[];
  rejectedProposalIds: Array<{ proposalId: string; reason: string }>;
  provenanceByTarget: Record<string, MergeProvenance>;
}

export interface AiMergeThresholds {
  minComponentPatchConfidence: number;
  minFlowPatchConfidence: number;
  minInsertFlowConfidence: number;
}

export interface InferencePlannerOptions {
  maxCandidatesPerAgent?: number;
  totalBudgetTokens: number;
  maxModelCalls: number;
}

export interface AiQueuePlan {
  agent: AiAgentName;
  queue: AiInferenceCandidate[];
  budgetTokens: number;
  maxModelCalls: number;
}

export interface InferencePlannerResult {
  queues: AiQueuePlan[];
  droppedCandidates: Array<{ candidateId: string; reason: string }>;
}

export interface RunInferencePipelineInput {
  components: DetectedComponent[];
  dataFlows: DetectedDataFlow[];
  sections?: ServiceSection[];
  /** Structural scan file bodies; used for prompt excerpts and agent tooling. */
  files?: FileInfo[];
  findings?: RawFinding[];
  inferenceScope?: AiInferenceScope;
  plannerOptions?: Partial<InferencePlannerOptions>;
}

export interface GenerateProposalsContext {
  candidates: AiInferenceCandidate[];
  plan: InferencePlannerResult;
  components: DetectedComponent[];
  dataFlows: DetectedDataFlow[];
  sections?: ServiceSection[];
  files?: FileInfo[];
  findings?: RawFinding[];
}

export interface RunInferencePipelineOptions {
  generateProposals?: (
    context: GenerateProposalsContext,
  ) => Promise<{
    proposals: Array<{ id: string; proposal: AiProposal }>;
    usageSummary?: AiInferenceUsageSummary;
  }>;
}

export interface InferencePipelineResult {
  candidates: AiInferenceCandidate[];
  plan: InferencePlannerResult;
  proposals: Array<{ id: string; proposal: AiProposal }>;
  usageSummary?: AiInferenceUsageSummary;
  mergeResult: AiMergeResult;
}

export interface AiInferenceUsageSummary {
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  agenticTrace?: AiCandidateAgentTrace[];
}

export interface AiToolCallTrace {
  round: number;
  action: "seed_files" | "search_text" | "expand_imports" | "provider_infer" | "finalize";
  detail: string;
  filesTouched?: string[];
  stats?: Record<string, number>;
}

export interface AiCandidateAgentTrace {
  candidateId: string;
  componentId?: string;
  filesReviewed: string[];
  rounds: number;
  toolCalls: AiToolCallTrace[];
  finalProposalCount: number;
}
