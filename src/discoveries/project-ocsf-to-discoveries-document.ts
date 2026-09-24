import type { OcsfDiscoveryRecord } from "../../tests/eval/interview-a0/ocsf-discovery-types";
import {
  type A0DiscoveriesDocument,
  validateA0DiscoveriesDocument,
} from "../../tests/eval/a0-diagram/a0-discoveries-document.schema";
import { indexDiscoverySlots, discoveryValue } from "./load-ocsf-discoveries";
import { parseScanEntityAsserts, projectedEntityId } from "./scan-entity-uri";

const SYSTEM_ASSERTS_URI = "dp:a0/system";

function parseScanEntityId(asserts: string): string | null {
  return parseScanEntityAsserts(asserts)?.entityId ?? null;
}

function entityKind(entityId: string): "component" | "flow" | "mention" | "data_item" | null {
  if (entityId.startsWith("mention:")) {
    return "mention";
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

function assertsForProjectedId(scanUris: Set<string>, projectedId: string): string {
  for (const uri of scanUris) {
    const parsed = parseScanEntityAsserts(uri);
    if (parsed && projectedEntityId(parsed.scanPath, parsed.entityId) === projectedId) {
      return uri;
    }
  }
  throw new Error(`Missing scan entity URI for ${projectedId}`);
}

function scanEntityUrisFromRecords(records: OcsfDiscoveryRecord[]): Set<string> {
  const uris = new Set<string>();
  for (const record of records) {
    if (record.dataparade.source !== "scan") {
      continue;
    }
    const asserts = record.dataparade.asserts;
    if (parseScanEntityAsserts(asserts)) {
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
  const mentionIds: string[] = [];
  const dataItemIds: string[] = [];

  for (const uri of scanUris) {
    const parsed = parseScanEntityAsserts(uri);
    if (!parsed) {
      continue;
    }
    const entityId = projectedEntityId(parsed.scanPath, parsed.entityId);
    const kind = entityKind(parsed.entityId);
    switch (kind) {
      case "component":
        componentIds.push(entityId);
        break;
      case "flow":
        flowIds.push(entityId);
        break;
      case "mention":
        mentionIds.push(entityId);
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
  mentionIds.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  dataItemIds.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const components = componentIds.map((id) => {
    const asserts = assertsForProjectedId(scanUris, id);
    const parsed = parseScanEntityAsserts(asserts);
    const scanPath = parsed?.scanPath ?? "";
    const actorKind = discoveryValue(slotIndex, asserts, "actor_kind");
    const dataItemIdsForComponent = parseJsonArray(
      discoveryValue(slotIndex, asserts, "data_item_ids"),
    ).map((dataItemId) => projectedEntityId(scanPath, dataItemId));
    return {
      id,
      ...(scanPath ? { scanPath } : {}),
      name: discoveryValue(slotIndex, asserts, "name") ?? id,
      type: discoveryValue(slotIndex, asserts, "type") ?? "asset",
      subType: discoveryValue(slotIndex, asserts, "sub_type") ?? "",
      confidence: parseNumber(discoveryValue(slotIndex, asserts, "confidence")),
      sourceLocations: parseSourceLocations(discoveryValue(slotIndex, asserts, "source_locations")),
      dataItemIds: dataItemIdsForComponent,
      ...(actorKind ? { actor_kind: actorKind } : {}),
    };
  });

  const dataFlows = flowIds.map((id) => {
    const asserts = assertsForProjectedId(scanUris, id);
    const scanPath = parseScanEntityAsserts(asserts)?.scanPath ?? "";
    const categoriesRaw = discoveryValue(slotIndex, asserts, "data_categories");
    const purpose = discoveryValue(slotIndex, asserts, "purpose");
    const dataCategories = parseCategoriesValue(categoriesRaw);
    const targetScope = discoveryValue(slotIndex, asserts, "target_scope");

    const sourceComponentId = discoveryValue(slotIndex, asserts, "source_component");
    const targetComponentId = discoveryValue(slotIndex, asserts, "target_component");
    if (!sourceComponentId) {
      throw new Error(`Flow ${id} missing source_component in scan OCSF`);
    }
    if (!targetComponentId) {
      throw new Error(`Flow ${id} missing target_component in scan OCSF`);
    }

    return {
      id,
      ...(scanPath ? { scanPath } : {}),
      sourceComponentId: projectedEntityId(scanPath, sourceComponentId),
      targetComponentId: projectedEntityId(scanPath, targetComponentId),
      type: discoveryValue(slotIndex, asserts, "type") ?? "data_transfer",
      confidence: parseNumber(discoveryValue(slotIndex, asserts, "confidence")),
      ...(targetScope ? { targetScope } : {}),
      ...(dataCategories && dataCategories.length > 0 ? { data_categories: dataCategories } : {}),
      ...(purpose ? { purpose } : {}),
    };
  });

  const mentions = mentionIds.map((id) => {
    const asserts = assertsForProjectedId(scanUris, id);
    const scanPath = parseScanEntityAsserts(asserts)?.scanPath ?? "";
    const code = discoveryValue(slotIndex, asserts, "code");
    return {
      id,
      ...(scanPath ? { scanPath } : {}),
      filePath:
        discoveryValue(slotIndex, asserts, "file_path") ??
        (() => {
          throw new Error(`Mention ${id} missing file_path in scan OCSF`);
        })(),
      startLine: parseNumber(discoveryValue(slotIndex, asserts, "start_line")),
      endLine: parseNumber(discoveryValue(slotIndex, asserts, "end_line")),
      ...(code !== undefined ? { code } : {}),
    };
  });

  const dataItems = dataItemIds.map((id) => {
    const asserts = assertsForProjectedId(scanUris, id);
    const scanPath = parseScanEntityAsserts(asserts)?.scanPath ?? "";
    const mentionIdsFromSlot = parseJsonArray(
      discoveryValue(slotIndex, asserts, "mention_ids"),
    ).map((mentionId) => projectedEntityId(scanPath, mentionId));
    const legacyMentionId = discoveryValue(slotIndex, asserts, "mention");
    const mentionIds =
      mentionIdsFromSlot.length > 0
        ? mentionIdsFromSlot
        : legacyMentionId
          ? [projectedEntityId(scanPath, legacyMentionId)]
          : (() => {
              throw new Error(`Data item ${id} missing mention_ids in scan OCSF`);
            })();
    return {
      id,
      ...(scanPath ? { scanPath } : {}),
      mentionIds,
    };
  });

  const inScope = discoveryValue(slotIndex, SYSTEM_ASSERTS_URI, "in_scope");
  const document: A0DiscoveriesDocument = {
    components,
    dataFlows,
    dataItems,
    mentions,
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
    if (!parseScanEntityAsserts(asserts)) {
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
