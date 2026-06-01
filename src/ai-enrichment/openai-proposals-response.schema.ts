/**
 * Zod schema for OpenAI Chat Completions structured outputs (`response_format.type: json_schema`).
 * Kept in sync with {@link normalizeProposal} shapes in `provider-contract.ts`.
 */
import { z } from "zod";

const aiCandidateTypeSchema = z.enum([
  "third_party",
  "node_property",
  "flow_direction",
  "missing_interaction",
]);

const evidenceSchema = z.object({
  filePath: z.string().describe("Path from scan payload (detectedFrom / sourceLocations)."),
  startLine: z.number(),
  endLine: z.number(),
  reason: z.string(),
});

const confidenceSchema = z.object({
  score: z.number().min(0).max(1),
  band: z.enum(["high", "medium", "low"]),
});

/** Property bag: snake_case keys; values as returned by the model (strings, bools, numbers, arrays, null). */
const setPropertiesSchema = z
  .record(z.string(), z.unknown())
  .describe("setProperties: snake_case keys from sparsePropertyKeys; arrays for multi-value fields.");

const propertyEvidenceSchema = z
  .record(z.string(), z.array(evidenceSchema))
  .describe(
    "Map each setProperties key you output to a non-empty array of evidence rows (filePath, line range, reason).",
  );

const componentPatchSchema = z.object({
  kind: z.literal("component_patch"),
  targetComponentId: z.string(),
  candidateType: aiCandidateTypeSchema,
  setSubType: z.string().optional(),
  setDescription: z.string().optional(),
  setProperties: setPropertiesSchema,
  propertyEvidence: propertyEvidenceSchema,
  confidence: confidenceSchema,
  evidence: z.array(evidenceSchema).optional(),
});

const dataFlowTypeSchema = z.enum([
  "api_call",
  "database_query",
  "message_queue",
  "file_transfer",
  "webhook",
  "rpc",
]);

const flowPatchSchema = z.object({
  kind: z.literal("flow_patch"),
  candidateType: aiCandidateTypeSchema,
  targetFlowId: z.string().optional(),
  insertIfMissing: z.boolean().optional(),
  sourceComponentId: z.string().optional(),
  targetComponentId: z.string().optional(),
  setType: dataFlowTypeSchema.optional(),
  setDirection: z.enum(["forward", "reverse"]).optional(),
  setMethod: z.string().optional(),
  setEndpoint: z.string().optional(),
  setDescription: z.string().optional(),
  confidence: confidenceSchema,
  evidence: z.array(evidenceSchema),
});

export const openAiProposalsResponseSchema = z.object({
  proposals: z.array(z.discriminatedUnion("kind", [componentPatchSchema, flowPatchSchema])),
});

export type OpenAiProposalsResponse = z.infer<typeof openAiProposalsResponseSchema>;

/**
 * JSON Schema for `response_format.json_schema`, with `$schema` removed for broader API compatibility.
 * Use `strict: false` so Zod optional fields (OpenAI: non–all-required) remain valid.
 */
export function getOpenAiProposalsResponseJsonSchemaForApi(options?: {
  /** OpenAI `json_schema.strict`; requires every object to list all keys — keep false with Zod optionals. */
  strict?: boolean;
}): { name: string; strict: boolean; schema: Record<string, unknown> } {
  const raw = z.toJSONSchema(openAiProposalsResponseSchema) as Record<string, unknown>;
  delete raw.$schema;
  return {
    name: "dataparade_proposals",
    strict: options?.strict ?? false,
    schema: raw,
  };
}
