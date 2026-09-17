import { z } from "zod";

import {
  PINNED_OCSF_BASE_VERSION,
  PINNED_OCSF_EXTENSION_NAME,
  PINNED_OCSF_EXTENSION_VERSION,
  PINNED_OCSF_ONTOLOGY_VERSION,
  OCSF_ARCHITECTURE_CATEGORY_UID,
  OCSF_ARCHITECTURE_DISCOVERY_CLASS_UID,
  OCSF_ARCHITECTURE_DISCOVERY_TYPE_UID,
} from "./ocsf-pins";
import { PINNED_BRIEF_SHA, PINNED_SKILL_SHA } from "./pins";

const dataparadePayloadSchema = z
  .object({
    record_kind: z.literal("discovery"),
    ontology_version: z.literal(PINNED_OCSF_ONTOLOGY_VERSION),
    source: z.enum(["scan", "cloud", "interview"]),
    asserted_at: z.string().datetime(),
    asserts: z.string().min(1),
    asserted_slot: z.string().min(1).optional(),
    asserted_value: z.string().min(1).optional(),
    eligible_shape: z.enum(["D2", "D4", "D7", "D8"]).optional(),
    raw_evidence_ref: z.string().min(1).optional(),
    reviewer: z.string().min(1).optional(),
    reviewed_at: z.string().datetime().optional(),
    brief_sha: z.literal(PINNED_BRIEF_SHA).optional(),
    skill_sha: z.literal(PINNED_SKILL_SHA).optional(),
    supersedes: z.string().min(1).optional(),
    related_resource_refs: z.array(z.string().min(1)).optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.source === "interview") {
      const required = [
        "raw_evidence_ref",
        "reviewer",
        "reviewed_at",
        "brief_sha",
        "skill_sha",
      ] as const;
      for (const key of required) {
        if (!payload[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `interview Discovery requires ${key}`,
            path: [key],
          });
        }
      }
    }
  });

export const ocsfDiscoveryRecordSchema = z.object({
  class_name: z.literal("Architecture Discovery"),
  class_uid: z.literal(OCSF_ARCHITECTURE_DISCOVERY_CLASS_UID),
  category_name: z.literal("Architecture"),
  category_uid: z.literal(OCSF_ARCHITECTURE_CATEGORY_UID),
  activity_id: z.literal(1),
  activity_name: z.literal("Create"),
  type_uid: z.literal(OCSF_ARCHITECTURE_DISCOVERY_TYPE_UID),
  time: z.number().int().nonnegative(),
  metadata: z.object({
    version: z.literal(PINNED_OCSF_BASE_VERSION),
    uid: z.string().min(1),
    extension: z.object({
      name: z.literal(PINNED_OCSF_EXTENSION_NAME),
      version: z.literal(PINNED_OCSF_EXTENSION_VERSION),
    }),
    product: z
      .object({
        name: z.string(),
        vendor_name: z.string(),
      })
      .optional(),
    profiles: z.array(z.string()).optional(),
  }),
  resources: z
    .array(
      z.object({
        uid: z.string(),
        name: z.string().optional(),
        type: z.string().optional(),
      }),
    )
    .optional(),
  dataparade: dataparadePayloadSchema,
});

export type OcsfDiscoveryRecord = z.infer<typeof ocsfDiscoveryRecordSchema>;
