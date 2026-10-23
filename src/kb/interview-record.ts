import {
  OCSF_ARCHITECTURE_CATEGORY_UID,
  OCSF_ARCHITECTURE_DISCOVERY_CLASS_UID,
  OCSF_ARCHITECTURE_DISCOVERY_TYPE_UID,
  PINNED_OCSF_BASE_VERSION,
  PINNED_OCSF_EXTENSION_NAME,
  PINNED_OCSF_EXTENSION_VERSION,
} from "../discoveries/contract/ocsf-pins";
import type { OcsfDiscoveryRecord } from "../discoveries/contract/ocsf-discovery-record";
import { PINNED_ONTOLOGY_VERSION } from "../discoveries/contract/ontology-pins";
import { scanEntityAsserts } from "../discoveries/scan-entity-uri";
import { slugifyDiscoveryId } from "../discoveries/write-ocsf-discoveries";
import type { Answer } from "../facts/schema";
import { SHAPE_FOR_SLOT, SYSTEM_ASSERTS_URI, type InterviewSlot } from "./slot-shapes";

/** The OCSF `asserts` URI for a Fact id (the system keeps its own URI). */
export function factAssertsUri(factId: string): string {
  return factId.startsWith("dp:") ? factId : scanEntityAsserts(undefined, factId);
}

/** The slot value as OCSF stores it: text, with a category list as JSON. */
export function slotValueText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export interface InterviewRecordInput {
  uid: string;
  answer: Answer;
  slot: InterviewSlot;
  briefSha: string;
  skillSha: string;
  supersedes?: string;
}

/** One OCSF Architecture Discovery (`source=interview`) for an interview answer. */
export function buildInterviewOcsfRecord(input: InterviewRecordInput): OcsfDiscoveryRecord {
  const { answer, slot } = input;
  const asserts = factAssertsUri(answer.factId);
  const time = Date.parse(answer.at);
  const at = new Date(time).toISOString();
  return {
    class_name: "Architecture Discovery",
    class_uid: OCSF_ARCHITECTURE_DISCOVERY_CLASS_UID,
    category_name: "Architecture",
    category_uid: OCSF_ARCHITECTURE_CATEGORY_UID,
    activity_id: 1,
    activity_name: "Create",
    type_uid: OCSF_ARCHITECTURE_DISCOVERY_TYPE_UID,
    time: Math.floor(time / 1000),
    metadata: {
      version: PINNED_OCSF_BASE_VERSION,
      uid: input.uid,
      extension: { name: PINNED_OCSF_EXTENSION_NAME, version: PINNED_OCSF_EXTENSION_VERSION },
      product: { name: "dataparade-cli", vendor_name: "DataParade" },
      profiles: ["architecture_privacy"],
    },
    resources: [
      {
        uid: asserts,
        name: answer.factId,
        type: asserts === SYSTEM_ASSERTS_URI ? "system" : "entity",
      },
    ],
    dataparade: {
      record_kind: "discovery",
      ontology_version: PINNED_ONTOLOGY_VERSION,
      source: "interview",
      asserted_at: at,
      asserts,
      asserted_slot: slot,
      asserted_value: slotValueText(answer.value),
      eligible_shape: SHAPE_FOR_SLOT[slot].shape,
      raw_evidence_ref: answer.evidence ?? "evidence/unknown",
      reviewer: answer.by,
      reviewed_at: at,
      brief_sha: input.briefSha,
      skill_sha: input.skillSha,
      ...(input.supersedes ? { supersedes: input.supersedes } : {}),
      ...(asserts !== SYSTEM_ASSERTS_URI ? { related_resource_refs: [answer.factId] } : {}),
    },
  };
}

export function interviewRecordUid(answerId: string): string {
  return `dp:discovery/interview/${slugifyDiscoveryId(answerId)}`;
}
