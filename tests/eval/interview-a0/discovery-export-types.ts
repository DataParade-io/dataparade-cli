import { z } from "zod";

/**
 * Eligible write-back shapes per DATAP-682:
 * D2=in_scope, D4=actor_kind, D7=data_categories, D8=purpose.
 */
export type EligibleInterviewShape = "D2" | "D4" | "D7" | "D8";

/** Refusal codes for ineligible interview writes (fail-closed). */
export type InterviewDiscoveryRefusalCode =
  | "D5_IDENTITY_REWRITE"
  | "D6_ENDPOINT_REASK"
  | "D9_BOUNDARY"
  | "MUSH_MERGE"
  | "SCAN_WINS"
  | "INELIGIBLE_SLOT"
  | "INVALID_SHAPE"
  | "NOT_INTERVIEW_WRITE"
  | "FROZEN_SCRIPTED_EXAM";

export const interviewDiscoverySourceSchema = z.literal("interview");
export type InterviewDiscoverySource = z.infer<typeof interviewDiscoverySourceSchema>;

export const interviewDiscoveryRecordSchema = z.object({
  id: z.string().min(1),
  class: z.literal("Discovery"),
  source: interviewDiscoverySourceSchema,
  asserted_at: z.string().datetime(),
  asserts: z.string().min(1),
  asserted_slot: z.string().min(1),
  asserted_value: z.string().min(1),
  eligible_shape: z.enum(["D2", "D4", "D7", "D8"]),
  raw_evidence_ref: z.string().min(1),
  brief_sha: z.string().length(40),
  skill_sha: z.string().length(40),
  reviewer: z.string().optional(),
  reviewed_at: z.string().datetime().optional(),
});
export type InterviewDiscoveryRecord = z.infer<typeof interviewDiscoveryRecordSchema>;

export const interviewDiscoveryRefusalSchema = z.object({
  action_index: z.number().int().nonnegative(),
  code: z.enum([
    "D5_IDENTITY_REWRITE",
    "D6_ENDPOINT_REASK",
    "D9_BOUNDARY",
    "MUSH_MERGE",
    "SCAN_WINS",
    "INELIGIBLE_SLOT",
    "INVALID_SHAPE",
    "NOT_INTERVIEW_WRITE",
    "FROZEN_SCRIPTED_EXAM",
  ]),
  message: z.string().min(1),
});
export type InterviewDiscoveryRefusal = z.infer<typeof interviewDiscoveryRefusalSchema>;

export const interviewDiscoveryExportSchema = z.object({
  export_kind: z.literal("interview_discovery_bundle"),
  surface: z.literal("a0-data-flow"),
  ontology_version: z.literal("0.2.0"),
  ontology_tag: z.literal("v0.2.0"),
  ontology_sha: z.literal("0656c5d9a6ce0d31440c63327ce597ce8df4414f"),
  write_back_kb_sha: z.literal("f8b4f2810f0be856f9bf5421af5ea0db51ecd768"),
  adapter_only: z.literal(true),
  landable: z.literal(false),
  promotion_blocked: z.boolean(),
  promotion_block_reason: z.string().optional(),
  interview_id: z.string().min(1),
  discoveries: z.array(interviewDiscoveryRecordSchema),
  refused: z.array(interviewDiscoveryRefusalSchema),
});
export type InterviewDiscoveryExport = z.infer<typeof interviewDiscoveryExportSchema>;
