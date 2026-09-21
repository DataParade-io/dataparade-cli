import type { OcsfDiscoveryRecord } from "./ocsf-discovery-types";
import { OCSF_ARCHITECTURE_DISCOVERY_CLASS_UID } from "./ocsf-pins";

/**
 * Minimal OCSF Finding envelope for Finding↔Discovery join (DATAP-696 follow-on).
 * Contract per ontology `finding_discovery_link` — fixture/helper only; no lake ingest.
 */
export interface OcsfFindingRecord {
  class_name: string;
  class_uid: number;
  category_name?: string;
  category_uid?: number;
  resources?: Array<{ uid: string; name?: string; type?: string }>;
  unmapped?: {
    dataparade?: {
      related_discovery_ids?: string[];
    };
  };
  metadata?: {
    uid?: string;
  };
}

/** Primary join: normalize Finding.resources[].uid to graph entity URI. */
export function graphEntityUriFromResourceUid(resourceUid: string): string {
  if (resourceUid.startsWith("dp:")) {
    return resourceUid;
  }
  return `dp:scan/entity/${resourceUid}`;
}

/** Secondary join: explicit back-link on the Finding. */
export function relatedDiscoveryIdsFromFinding(finding: OcsfFindingRecord): string[] {
  const explicit = finding.unmapped?.dataparade?.related_discovery_ids ?? [];
  return explicit.filter((id) => id.length > 0);
}

/** Primary join: match Finding resource UIDs to Discovery.dataparade.asserts. */
export function discoveryIdsByResourceAssert(
  finding: OcsfFindingRecord,
  discoveries: OcsfDiscoveryRecord[],
): string[] {
  const assertedUris = new Set(
    (finding.resources ?? []).map((resource) => graphEntityUriFromResourceUid(resource.uid)),
  );
  if (assertedUris.size === 0) {
    return [];
  }

  const matches: string[] = [];
  for (const discovery of discoveries) {
    if (
      discovery.class_uid !== OCSF_ARCHITECTURE_DISCOVERY_CLASS_UID ||
      !assertedUris.has(discovery.dataparade.asserts)
    ) {
      continue;
    }
    matches.push(discovery.metadata.uid);
  }
  return matches;
}

/**
 * Resolve Discovery ids for a Finding using ontology join rules:
 * 1. Secondary explicit `related_discovery_ids` when present
 * 2. Else primary resource UID → Discovery.asserts
 * Never invents joins when neither side provides a link.
 */
export function resolveDiscoveryIdsForFinding(
  finding: OcsfFindingRecord,
  discoveries: OcsfDiscoveryRecord[],
): string[] {
  const explicit = relatedDiscoveryIdsFromFinding(finding);
  if (explicit.length > 0) {
    return [...new Set(explicit)];
  }

  const primary = discoveryIdsByResourceAssert(finding, discoveries);
  return [...new Set(primary)];
}
