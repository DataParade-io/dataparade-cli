import {
  PINNED_OCSF_BASE_VERSION,
  PINNED_OCSF_EXTENSION_NAME,
  PINNED_OCSF_EXTENSION_VERSION,
  PINNED_OCSF_ONTOLOGY_VERSION,
  OCSF_ARCHITECTURE_CATEGORY_UID,
  OCSF_ARCHITECTURE_DISCOVERY_CLASS_UID,
  OCSF_ARCHITECTURE_DISCOVERY_TYPE_UID,
} from "./ocsf-pins";
import type { OcsfDiscoveryRecord } from "./ocsf-discovery-types";
import type { LandCandidate, LandCandidateDiscovery } from "./land-candidate-types";

function parseAssertedEntityId(asserts: string): string | null {
  const match = asserts.match(/^dp:scan\/entity\/(.+)$/);
  return match?.[1] ?? null;
}

function relatedResourceRefs(asserts: string): string[] | undefined {
  const entityId = parseAssertedEntityId(asserts);
  if (!entityId) {
    return undefined;
  }
  return [entityId];
}

function toUnixSeconds(assertedAt: string): number {
  const ms = Date.parse(assertedAt);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid asserted_at datetime: ${assertedAt}`);
  }
  return Math.floor(ms / 1000);
}

export function landCandidateDiscoveryToOcsf(
  discovery: LandCandidateDiscovery,
  candidate: LandCandidate,
  reviewer: string,
  rawEvidenceRef: string,
): OcsfDiscoveryRecord {
  const reviewedAt = candidate.reviewed_at ?? discovery.asserted_at;

  return {
    class_name: "Architecture Discovery",
    class_uid: OCSF_ARCHITECTURE_DISCOVERY_CLASS_UID,
    category_name: "Architecture",
    category_uid: OCSF_ARCHITECTURE_CATEGORY_UID,
    activity_id: 1,
    activity_name: "Create",
    type_uid: OCSF_ARCHITECTURE_DISCOVERY_TYPE_UID,
    time: toUnixSeconds(discovery.asserted_at),
    metadata: {
      version: PINNED_OCSF_BASE_VERSION,
      uid: discovery.id,
      extension: {
        name: PINNED_OCSF_EXTENSION_NAME,
        version: PINNED_OCSF_EXTENSION_VERSION,
      },
      product: {
        name: "dataparade-cli",
        vendor_name: "DataParade",
      },
      profiles: ["architecture_privacy"],
    },
    resources: [
      {
        uid: discovery.asserts,
        name: parseAssertedEntityId(discovery.asserts) ?? discovery.asserts,
        type: discovery.asserts === "dp:a0/system" ? "system" : "entity",
      },
    ],
    dataparade: {
      record_kind: "discovery",
      ontology_version: PINNED_OCSF_ONTOLOGY_VERSION,
      source: "interview",
      asserted_at: discovery.asserted_at,
      asserts: discovery.asserts,
      asserted_slot: discovery.asserted_slot,
      asserted_value: discovery.asserted_value,
      eligible_shape: discovery.eligible_shape,
      raw_evidence_ref: rawEvidenceRef,
      reviewer,
      reviewed_at: reviewedAt,
      brief_sha: candidate.brief_sha,
      skill_sha: candidate.skill_sha,
      related_resource_refs: relatedResourceRefs(discovery.asserts),
    },
  };
}

export function landCandidateToOcsfRecords(
  candidate: LandCandidate,
  reviewer: string,
  rawEvidenceRef: string,
): OcsfDiscoveryRecord[] {
  return candidate.discoveries.map((discovery) =>
    landCandidateDiscoveryToOcsf(discovery, candidate, reviewer, rawEvidenceRef),
  );
}
