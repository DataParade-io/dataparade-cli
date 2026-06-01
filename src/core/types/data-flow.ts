import type { SourceLocation } from "./file";

export type DataFlowType =
  | "api_call"
  | "database_query"
  | "message_queue"
  | "file_transfer"
  | "webhook"
  | "rpc";

export interface DetectedDataFlow {
  id: string;
  sourceComponentId: string;
  targetComponentId: string;
  type: DataFlowType;
  description?: string;
  confidence: number;
  sourceLocation?: SourceLocation;
  sourceLocations?: SourceLocation[];
  method?: string;
  endpoint?: string;
  dataCategories?: string[];
  dataSubjectCategories?: string[];
  processingPurpose?: string[];
  actions?: string[];
  transformation?: string[];
  enrichmentConfidence?: number;
  enrichmentNotes?: string;
  targetScope?: "local" | "cross_section_internal" | "external" | "unknown";
  targetScopeConfidence?: "high" | "medium" | "low";
  targetScopeReason?: string;
}

