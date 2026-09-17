import { z } from "zod";

import type { EligibleInterviewShape } from "./discovery-export-types";

export const landCandidateDiscoverySchema = z.object({
  id: z.string().min(1),
  class: z.literal("Discovery"),
  source: z.literal("interview"),
  asserted_at: z.string().datetime(),
  asserts: z.string().min(1),
  asserted_slot: z.string().min(1),
  asserted_value: z.string().min(1),
  eligible_shape: z.enum(["D2", "D4", "D7", "D8"]),
});
export type LandCandidateDiscovery = z.infer<typeof landCandidateDiscoverySchema>;

export const landCandidateSchema = z.object({
  land_candidate_id: z.string().min(1),
  ticket: z.string().optional(),
  ontology_version: z.literal("0.2.0"),
  ontology_sha: z.literal("0656c5d9a6ce0d31440c63327ce597ce8df4414f"),
  skill_sha: z.literal("f8b4f2810f0be856f9bf5421af5ea0db51ecd768"),
  brief_sha: z.literal("16f2e857a47d54bfea6ca5d7f23a6c4f2732da29"),
  reviewer: z.string(),
  reviewed_at: z.string().datetime().optional(),
  raw_evidence_ref: z.string(),
  discoveries: z.array(landCandidateDiscoverySchema).min(1),
  source_interview_id: z.string().optional(),
});
export type LandCandidate = z.infer<typeof landCandidateSchema>;

export const ELIGIBLE_SHAPES = new Set<EligibleInterviewShape>(["D2", "D4", "D7", "D8"]);
