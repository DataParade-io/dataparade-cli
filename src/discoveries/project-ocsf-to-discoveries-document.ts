import type { OcsfDiscoveryRecord } from "../../tests/eval/interview-a0/ocsf-discovery-types";
import {
  type A0DiscoveriesDocument,
  validateA0DiscoveriesDocument,
} from "../../tests/eval/a0-diagram/a0-discoveries-document.schema";
import { indexDiscoverySlots, discoveryValue } from "./load-ocsf-discoveries";

const SYSTEM_ASSERTS_URI = "dp:a0/system";

function parseScanEntityId(asserts: string): string | null {
  if (!asserts.startsWith("dp:scan/entity/")) {
    return null;
  }
  return asserts.slice("dp:scan/entity/".length);
}

/** Discoveries written before the mention -> occurrence rename (ontology < 0.4.0). */
const LEGACY_OCCURRENCE_PREFIX = "mention:";

/** `mention:email:a.ts:3` -> `occurrence:email:a.ts:3`; other ids unchanged. */
export function normalizeOccurrenceId(entityId: string): string {
  return entityId.startsWith(LEGACY_OCCURRENCE_PREFIX)
    ? `occurrence:${entityId.slice(LEGACY_OCCURRENCE_PREFIX.length)}`
    : entityId;
}

function entityKind(entityId: string): "component" | "flow" | "occurrence" | "data_item" | null {
  if (entityId.startsWith("occurrence:") || entityId.startsWith(LEGACY_OCCURRENCE_PREFIX)) {
    return "occurrence";
  }
  if (entityId.startsWith("data_item:")) {
    return "data_item";
  }
  if (entityId.startsWith("cmp_")) {
    return "component";
  }
  if (entityId.startsWith("flow_")) {
    return "flow";
  }
  return null;
}

function parseJsonArray(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(String);
    }
  } catch {
    return [];
  }
  return [];
}

function parseCategoriesValue(raw: string | undefined): string[] | undefined {
  const values = parseJsonArray(raw);
  return values.length > 0 ? values : undefined;
}

function parseSourceLocations(
  raw: string | undefined,
): A0DiscoveriesDocument["components"][number]["sourceLocations"] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as A0DiscoveriesDocument["components"][number]["sourceLocations"];
    }
  } catch {
    return [];
  }
  return [];
}

function parseNumber(raw: string | undefined, fallback = 0): number {
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function scanEntityUrisFromRecords(records: OcsfDiscoveryRecord[]): Set<string> {
  const uris = new Set<string>();
  for (const record of records) {
    if (record.dataparade.source !== "scan") {
      continue;
    }
    const asserts = record.dataparade.asserts;
    if (asserts.startsWith("dp:scan/entity/")) {
      uris.add(asserts);
    }
  }
  return uris;
}

export interface ProjectOcsfToDiscoveriesDocumentInput {
  records: OcsfDiscoveryRecord[];
}

export function projectOcsfToDiscoveriesDocument(
  input: ProjectOcsfToDiscoveriesDocumentInput,
): A0DiscoveriesDocument {
  const scanUris = scanEntityUrisFromRecords(input.records);
  const slotIndex = indexDiscoverySlots(input.records);

  const componentIds: string[] = [];
  const flowIds: string[] = [];
  const occurrenceIds: string[] = [];
  const dataItemIds: string[] = [];

  for (const uri of scanUris) {
    const entityId = parseScanEntityId(uri);
    if (!entityId) {
      continue;
    }
    const kind = entityKind(entityId);
    switch (kind) {
      case "component":
        componentIds.push(entityId);
        break;
      case "flow":
        flowIds.push(entityId);
        break;
      case "occurrence":
        occurrenceIds.push(entityId);
        break;
      case "data_item":
        dataItemIds.push(entityId);
        break;
      default:
        break;
    }
  }

  componentIds.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  flowIds.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  occurrenceIds.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  dataItemIds.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const components = componentIds.map((id) => {
    const asserts = `dp:scan/entity/${id}`;
    const actorKind = discoveryValue(slotIndex, asserts, "actor_kind");
    return {
      id,
      name: discoveryValue(slotIndex, asserts, "name") ?? id,
      type: discoveryValue(slotIndex, asserts, "type") ?? "asset",
      subType: discoveryValue(slotIndex, asserts, "sub_type") ?? "",
      confidence: parseNumber(discoveryValue(slotIndex, asserts, "confidence")),
      sourceLocations: parseSourceLocations(discoveryValue(slotIndex, asserts, "source_locations")),
      dataItemIds: parseJsonArray(discoveryValue(slotIndex, asserts, "data_item_ids")),
      ...(actorKind ? { actor_kind: actorKind } : {}),
    };
  });

  const dataFlows = flowIds.map((id) => {
    const asserts = `dp:scan/entity/${id}`;
    const categoriesRaw = discoveryValue(slotIndex, asserts, "data_categories");
    const purpose = discoveryValue(slotIndex, asserts, "purpose");
    const dataCategories = parseCategoriesValue(categoriesRaw);
    const targetScope = discoveryValue(slotIndex, asserts, "target_scope");

    return {
      id,
      sourceComponentId:
        discoveryValue(slotIndex, asserts, "source_component") ??
        (() => {
          throw new Error(`Flow ${id} missing source_component in scan OCSF`);
        })(),
      targetComponentId:
        discoveryValue(slotIndex, asserts, "target_component") ??
        (() => {
          throw new Error(`Flow ${id} missing target_component in scan OCSF`);
        })(),
      type: discoveryValue(slotIndex, asserts, "type") ?? "data_transfer",
      confidence: parseNumber(discoveryValue(slotIndex, asserts, "confidence")),
      ...(targetScope ? { targetScope } : {}),
      ...(dataCategories && dataCategories.length > 0 ? { data_categories: dataCategories } : {}),
      ...(purpose ? { purpose } : {}),
    };
  });

  const occurrences = occurrenceIds.map((id) => {
    const asserts = `dp:scan/entity/${id}`;
    const code = discoveryValue(slotIndex, asserts, "code");
    return {
      id: normalizeOccurrenceId(id),
      filePath:
        discoveryValue(slotIndex, asserts, "file_path") ??
        (() => {
          throw new Error(`Occurrence ${id} missing file_path in scan OCSF`);
        })(),
      startLine: parseNumber(discoveryValue(slotIndex, asserts, "start_line")),
      endLine: parseNumber(discoveryValue(slotIndex, asserts, "end_line")),
      ...(code !== undefined ? { code } : {}),
    };
  });

  const dataItems = dataItemIds.map((id) => {
    const asserts = `dp:scan/entity/${id}`;
    const occurrenceIdsFromSlot = parseJsonArray(
      discoveryValue(slotIndex, asserts, "occurrence_ids") ??
        discoveryValue(slotIndex, asserts, "mention_ids"),
    ).map(normalizeOccurrenceId);
    const singleOccurrenceId =
      discoveryValue(slotIndex, asserts, "occurrence") ?? discoveryValue(slotIndex, asserts, "mention");
    const legacyOccurrenceId = singleOccurrenceId ? normalizeOccurrenceId(singleOccurrenceId) : undefined;
    const occurrenceIds =
      occurrenceIdsFromSlot.length > 0
        ? occurrenceIdsFromSlot
        : legacyOccurrenceId
          ? [legacyOccurrenceId]
          : (() => {
              throw new Error(`Data item ${id} missing occurrence_ids in scan OCSF`);
            })();
    return {
      id,
      occurrenceIds,
    };
  });

  const inScope = discoveryValue(slotIndex, SYSTEM_ASSERTS_URI, "in_scope");
  const document: A0DiscoveriesDocument = {
    components,
    dataFlows,
    dataItems,
    occurrences,
    ...(inScope ? { system: { in_scope: inScope } } : {}),
  };

  for (const record of input.records) {
    if (record.dataparade.source !== "interview") {
      continue;
    }
    const asserts = record.dataparade.asserts;
    if (asserts === SYSTEM_ASSERTS_URI) {
      const slot = record.dataparade.asserted_slot;
      if (slot && slot !== "in_scope") {
        throw new Error(
          `Interview system overlay ${record.metadata.uid} only allows in_scope; got ${slot}`,
        );
      }
      continue;
    }
    if (!asserts.startsWith("dp:scan/entity/")) {
      throw new Error(
        `Interview record ${record.metadata.uid} asserts unsupported URI ${asserts}`,
      );
    }
    if (!record.dataparade.asserted_slot) {
      throw new Error(
        `Interview record ${record.metadata.uid} must not assert scan entity existence`,
      );
    }
    if (!scanUris.has(asserts)) {
      throw new Error(`Interview record ${record.metadata.uid} must not create ${asserts}`);
    }
    const entityId = parseScanEntityId(asserts);
    const kind = entityId ? entityKind(entityId) : null;
    const slot = record.dataparade.asserted_slot;
    const allowed =
      (kind === "component" && slot === "actor_kind") ||
      (kind === "flow" && (slot === "data_categories" || slot === "purpose"));
    if (!allowed) {
      throw new Error(
        `Interview overlay ${record.metadata.uid} slot '${slot}' is not allowed on ${asserts}`,
      );
    }
  }

  const validation = validateA0DiscoveriesDocument(document);
  if (!validation.ok) {
    throw new Error(`Invalid A0 discoveries document: ${validation.errors.join("; ")}`);
  }

  return validation.value;
}
