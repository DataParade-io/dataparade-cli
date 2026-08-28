import { z } from "zod";
import type {
  DetectedComponent,
  DetectedDataFlow,
  FileInfo,
  LanguageParserStats,
  ScanResult,
  SourceLocation,
} from "../types";

const fileLanguageEnum = z.enum([
  "typescript",
  "javascript",
  "json",
  "yaml",
  "env",
  "python",
  "cpp",
  "csharp",
  "go",
  "java",
  "kotlin",
  "terraform",
  "dockerfile",
  "rust",
]);

export const sourceLocationSchema = z.object({
  filePath: z.string().min(1),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  code: z.string().optional(),
});

export const fileInfoSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  content: z.string(),
  language: fileLanguageEnum,
  size: z.number().int().nonnegative(),
});

export const detectedFromRefSchema = z.object({
  pattern: z.string().min(1),
  sourceLocation: sourceLocationSchema.optional(),
});

export const detectedComponentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["asset", "actor", "third_party"]),
  subType: z.string().min(1).optional(),
  description: z.string().optional(),
  confidence: z.number().min(0).max(1),
  detectedFrom: z.array(detectedFromRefSchema),
  sourceLocations: z.array(sourceLocationSchema),
  properties: z.record(z.string(), z.unknown()),
  dataFlowIds: z.array(z.string().min(1)).optional(),
});

export const detectedDataFlowSchema = z.object({
  id: z.string().min(1),
  sourceComponentId: z.string().min(1),
  targetComponentId: z.string().min(1),
  type: z.enum([
    "api_call",
    "database_query",
    "message_queue",
    "file_transfer",
    "webhook",
    "rpc",
  ]),
  description: z.string().optional(),
  confidence: z.number().min(0).max(1),
  sourceLocation: sourceLocationSchema.optional(),
  method: z.string().optional(),
  endpoint: z.string().optional(),
  dataCategories: z.array(z.string()).optional(),
  dataSubjectCategories: z.array(z.string()).optional(),
  processingPurpose: z.array(z.string()).optional(),
  actions: z.array(z.string()).optional(),
  transformation: z.array(z.string()).optional(),
  enrichmentConfidence: z.number().min(0).max(1).optional(),
  enrichmentNotes: z.string().optional(),
  targetScope: z
    .enum(["local", "cross_section_internal", "external", "unknown"])
    .optional(),
  targetScopeConfidence: z.enum(["high", "medium", "low"]).optional(),
  targetScopeReason: z.string().optional(),
});

export const languageParserStatsSchema = z.object({
  language: z.string().min(1),
  filesParsed: z.number().int().nonnegative(),
  functionsIndexed: z.number().int().nonnegative(),
  moduleLevelCallsIndexed: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export const structuralEnrichmentSummarySchema = z.object({
  ran: z.literal(true),
  proposalsGenerated: z.number().int().nonnegative(),
  proposalsApplied: z.number().int().nonnegative(),
  proposalsRejected: z.number().int().nonnegative(),
});

export const aiInferenceSummarySchema = z.object({
  ran: z.literal(true),
  candidatesConsidered: z.number().int().nonnegative(),
  proposalsGenerated: z.number().int().nonnegative(),
  proposalsApplied: z.number().int().nonnegative(),
  proposalsRejected: z.number().int().nonnegative(),
  proposalsGeneratedHeuristic: z.number().int().nonnegative(),
  proposalsAppliedHeuristic: z.number().int().nonnegative(),
  proposalsGeneratedProvider: z.number().int().nonnegative(),
  proposalsAppliedProvider: z.number().int().nonnegative(),
  providerCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  aiProvider: z.string(),
  aiModel: z.string(),
  thirdPartyPropertyCoverage: z
    .object({
      autofilled: z.record(z.string(), z.number().int().nonnegative()),
      suggested: z.record(z.string(), z.number().int().nonnegative()),
      unknown: z.record(z.string(), z.number().int().nonnegative()),
    })
    .optional(),
  thirdPartyDataFlow: z
    .object({
      entries: z.array(
        z.object({
          componentId: z.string().min(1),
          componentName: z.string().min(1),
          service: z.string().min(1).optional(),
          capabilities: z.array(z.string().min(1)),
          direction: z.enum([
            "outbound_to_third_party",
            "inbound_from_third_party",
            "bidirectional",
            "unknown",
          ]),
          dataShared: z.array(
            z.object({
              category: z.enum([
                "credentials",
                "auth_artifacts",
                "identifiers",
                "content_files",
                "telemetry",
                "financial",
                "health",
                "profile_data",
                "usage_metadata",
                "unknown",
              ]),
              labels: z.array(z.string().min(1)),
            }),
          ),
          confidence: z.number().min(0).max(1),
          confidenceBand: z.enum(["high", "medium", "low"]),
          source: z.enum(["provider", "heuristic", "provider_plus_heuristic"]),
          notes: z.array(z.string().min(1)).optional(),
          evidence: z.array(
            z.object({
              filePath: z.string().min(1),
              startLine: z.number().int().min(1),
              endLine: z.number().int().min(1),
              reason: z.string().min(1),
            }),
          ),
        }),
      ),
      totals: z.object({
        thirdPartiesAnalyzed: z.number().int().nonnegative(),
        withDataShared: z.number().int().nonnegative(),
      }),
    })
    .optional(),
  agenticTrace: z
    .array(
      z.object({
        candidateId: z.string().min(1),
        componentId: z.string().min(1).optional(),
        filesReviewed: z.array(z.string().min(1)),
        rounds: z.number().int().nonnegative(),
        finalProposalCount: z.number().int().nonnegative(),
        toolCalls: z.array(
          z.object({
            round: z.number().int().nonnegative(),
            action: z.string().min(1),
            detail: z.string().min(1),
            filesTouched: z.array(z.string().min(1)).optional(),
            stats: z.record(z.string(), z.number()).optional(),
          }),
        ),
      }),
    )
    .optional(),
});

const aiInferenceProposalDetailSchema = z.object({
  id: z.string().min(1),
  source: z.enum(["heuristic", "provider"]),
  status: z.enum(["applied", "rejected"]),
  rejectionReason: z.string().optional(),
  kind: z.enum(["component_patch", "flow_patch"]),
  candidateType: z.string().min(1),
  agent: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  confidence: z.number().min(0).max(1),
  confidenceBand: z.enum(["high", "medium", "low"]),
  targetComponentId: z.string().min(1).optional(),
  targetFlowId: z.string().min(1).optional(),
  sourceComponentId: z.string().min(1).optional(),
  targetFlowComponentId: z.string().min(1).optional(),
  evidence: z.array(
    z.object({
      filePath: z.string().min(1),
      startLine: z.number().int().min(1),
      endLine: z.number().int().min(1),
      reason: z.string().min(1),
    }),
  ),
  propertyChanges: z
    .array(
      z.object({
        key: z.string().min(1),
        from: z.unknown(),
        to: z.unknown(),
      }),
    )
    .optional(),
});

const terraformScanSummarySchema = z.object({
  mode: z.enum(["static_tf", "json_overlay", "json_only"]),
  staticTfFiles: z.number().int().nonnegative(),
  jsonInputPath: z.string().min(1).optional(),
  jsonFindingsMerged: z.number().int().nonnegative(),
});

export const scanResultSchema = z.object({
  components: z.array(detectedComponentSchema),
  dataFlows: z.array(detectedDataFlowSchema),
  filesScanned: z.number().int().nonnegative(),
  filesSkipped: z.number().int().nonnegative(),
  totalLines: z.number().int().nonnegative(),
  scanDurationMs: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  languageStats: z.array(languageParserStatsSchema).optional(),
  structuralEnrichmentSummary: structuralEnrichmentSummarySchema.optional(),
  aiInferenceSummary: aiInferenceSummarySchema.optional(),
  aiInferenceProposalDetails: z.array(aiInferenceProposalDetailSchema).optional(),
  terraformScanSummary: terraformScanSummarySchema.optional(),
});

export function parseScanResult(input: unknown): ScanResult {
  return scanResultSchema.parse(input) as ScanResult;
}

export function validateScanResult(input: unknown):
  | { ok: true; value: ScanResult }
  | { ok: false; errors: string[] } {
  const result = scanResultSchema.safeParse(input);

  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
    );
    return { ok: false, errors };
  }

  return { ok: true, value: result.data as ScanResult };
}

export type SourceLocationSchema = z.infer<typeof sourceLocationSchema>;
export type FileInfoSchema = z.infer<typeof fileInfoSchema>;
export type DetectedComponentSchema = z.infer<typeof detectedComponentSchema>;
export type DetectedDataFlowSchema = z.infer<typeof detectedDataFlowSchema>;
export type ScanResultSchema = z.infer<typeof scanResultSchema>;
export type LanguageParserStatsSchema = z.infer<typeof languageParserStatsSchema>;

