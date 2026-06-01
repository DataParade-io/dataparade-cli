import type { DetectedComponent } from "./component";
import type { DetectedDataFlow } from "./data-flow";

export interface LanguageParserStats {
  language: string;
  filesParsed: number;
  functionsIndexed: number;
  moduleLevelCallsIndexed: number;
  warnings: string[];
}

export type ThirdPartyDataDirection =
  | "outbound_to_third_party"
  | "inbound_from_third_party"
  | "bidirectional"
  | "unknown";

export type ThirdPartyDataCategory =
  | "credentials"
  | "auth_artifacts"
  | "identifiers"
  | "content_files"
  | "telemetry"
  | "financial"
  | "health"
  | "profile_data"
  | "usage_metadata"
  | "unknown";

export interface ThirdPartyDataFlowEvidenceRef {
  filePath: string;
  startLine: number;
  endLine: number;
  reason: string;
}

export interface ThirdPartyDataFlowElement {
  category: ThirdPartyDataCategory;
  labels: string[];
}

export interface ThirdPartyDataFlowEntry {
  componentId: string;
  componentName: string;
  service?: string;
  capabilities: string[];
  direction: ThirdPartyDataDirection;
  dataShared: ThirdPartyDataFlowElement[];
  confidence: number;
  confidenceBand: "high" | "medium" | "low";
  source: "provider" | "heuristic" | "provider_plus_heuristic";
  notes?: string[];
  evidence: ThirdPartyDataFlowEvidenceRef[];
}

export interface ThirdPartyDataFlowSummary {
  entries: ThirdPartyDataFlowEntry[];
  totals: {
    thirdPartiesAnalyzed: number;
    withDataShared: number;
  };
}

/** Local heuristic enrichment (not counted as platform AI tokens). */
export interface StructuralEnrichmentSummary {
  ran: true;
  proposalsGenerated: number;
  proposalsApplied: number;
  proposalsRejected: number;
}

/** Populated when LLM inference ran for this scan. */
export interface AiInferenceSummary {
  ran: true;
  /** Candidates passed to the inference planner (before per-agent caps). */
  candidatesConsidered: number;
  /** Proposals produced (heuristic agents + provider); merge may reject many. */
  proposalsGenerated: number;
  proposalsApplied: number;
  proposalsRejected: number;
  /** Built-in rules inside the inference step (often duplicate pattern-detection fields). */
  proposalsGeneratedHeuristic: number;
  proposalsAppliedHeuristic: number;
  /** Cloud model output (`provider_*` ids). */
  proposalsGeneratedProvider: number;
  proposalsAppliedProvider: number;
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  aiProvider: string;
  aiModel: string;
  thirdPartyPropertyCoverage?: {
    autofilled: Record<string, number>;
    suggested: Record<string, number>;
    unknown: Record<string, number>;
  };
  thirdPartyDataFlow?: ThirdPartyDataFlowSummary;
  agenticTrace?: Array<{
    candidateId: string;
    componentId?: string;
    filesReviewed: string[];
    rounds: number;
    finalProposalCount: number;
    toolCalls: Array<{
      round: number;
      action: string;
      detail: string;
      filesTouched?: string[];
      stats?: Record<string, number>;
    }>;
  }>;
}

export interface AiInferenceProposalDetail {
  id: string;
  source: "heuristic" | "provider";
  status: "applied" | "rejected";
  rejectionReason?: string;
  kind: "component_patch" | "flow_patch";
  candidateType: string;
  agent: string;
  provider: string;
  model: string;
  confidence: number;
  confidenceBand: "high" | "medium" | "low";
  targetComponentId?: string;
  targetFlowId?: string;
  sourceComponentId?: string;
  targetFlowComponentId?: string;
  evidence: Array<{
    filePath: string;
    startLine: number;
    endLine: number;
    reason: string;
  }>;
  propertyChanges?: Array<{
    key: string;
    from: unknown;
    to: unknown;
  }>;
}

export interface TerraformScanSummary {
  mode: "static_tf" | "json_overlay" | "json_only";
  staticTfFiles: number;
  jsonInputPath?: string;
  jsonFindingsMerged: number;
}

export interface ScanResult {
  components: DetectedComponent[];
  dataFlows: DetectedDataFlow[];
  filesScanned: number;
  filesSkipped: number;
  totalLines: number;
  scanDurationMs: number;
  warnings: string[];
  errors: string[];
  languageStats?: LanguageParserStats[];
  structuralEnrichmentSummary?: StructuralEnrichmentSummary;
  aiInferenceSummary?: AiInferenceSummary;
  aiInferenceProposalDetails?: AiInferenceProposalDetail[];
  terraformScanSummary?: TerraformScanSummary;
}

