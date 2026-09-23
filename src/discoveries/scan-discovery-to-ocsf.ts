import {
  PINNED_OCSF_BASE_VERSION,
  PINNED_OCSF_EXTENSION_NAME,
  PINNED_OCSF_EXTENSION_VERSION,
  OCSF_ARCHITECTURE_CATEGORY_UID,
  OCSF_ARCHITECTURE_DISCOVERY_CLASS_UID,
  OCSF_ARCHITECTURE_DISCOVERY_TYPE_UID,
} from "../../tests/eval/interview-a0/ocsf-pins";
import { PINNED_ONTOLOGY_VERSION } from "../../tests/eval/interview-a0/pins";
import type { OcsfDiscoveryRecord } from "../../tests/eval/interview-a0/ocsf-discovery-types";
import type {
  PersonalDataLandInput,
  ScanDiscoveryInput,
  ScanDiscoverySourceLocation,
} from "./scan-discovery-input";
import {
  PINNED_SCAN_ASSERTED_AT,
  PINNED_SCAN_LAND_DATE,
  landDateFromAssertedAt,
} from "./scan-ocsf-pins";

export interface LandScanDiscoveryOcsfOptions {
  assertedAt?: string;
  landDate?: string;
}

function toUnixSeconds(assertedAt: string): number {
  const ms = Date.parse(assertedAt);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid asserted_at datetime: ${assertedAt}`);
  }
  return Math.floor(ms / 1000);
}

function parseAssertedEntityId(asserts: string): string | null {
  const match = asserts.match(/^dp:scan\/entity\/(.+)$/);
  return match?.[1] ?? null;
}

function scanDiscoveryUid(asserts: string, landDate: string, slot?: string): string {
  const entityPart = asserts.replace(/^dp:/, "dp_").replace(/\//g, "_").replace(/:/g, "_");
  const slotPart = slot ?? "entity";
  return `dp:discovery/scan/${entityPart}/${slotPart}/${landDate}`;
}

function buildScanOcsfRecord(
  params: {
    asserts: string;
    assertedSlot?: string;
    assertedValue?: string;
  },
  timing: { assertedAt: string; landDate: string },
): OcsfDiscoveryRecord {
  const entityId = parseAssertedEntityId(params.asserts);
  const uid = scanDiscoveryUid(params.asserts, timing.landDate, params.assertedSlot);

  return {
    class_name: "Architecture Discovery",
    class_uid: OCSF_ARCHITECTURE_DISCOVERY_CLASS_UID,
    category_name: "Architecture",
    category_uid: OCSF_ARCHITECTURE_CATEGORY_UID,
    activity_id: 1,
    activity_name: "Create",
    type_uid: OCSF_ARCHITECTURE_DISCOVERY_TYPE_UID,
    time: toUnixSeconds(timing.assertedAt),
    metadata: {
      version: PINNED_OCSF_BASE_VERSION,
      uid,
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
        uid: params.asserts,
        name: entityId ?? params.asserts,
        type: "entity",
      },
    ],
    dataparade: {
      record_kind: "discovery",
      ontology_version: PINNED_ONTOLOGY_VERSION,
      source: "scan",
      asserted_at: timing.assertedAt,
      asserts: params.asserts,
      ...(params.assertedSlot ? { asserted_slot: params.assertedSlot } : {}),
      ...(params.assertedValue !== undefined ? { asserted_value: params.assertedValue } : {}),
      related_resource_refs: entityId ? [entityId] : undefined,
    },
  };
}

function slotRecord(
  asserts: string,
  slot: string,
  value: string,
  timing: { assertedAt: string; landDate: string },
): OcsfDiscoveryRecord {
  return buildScanOcsfRecord({ asserts, assertedSlot: slot, assertedValue: value }, timing);
}

function entityRecord(
  asserts: string,
  timing: { assertedAt: string; landDate: string },
): OcsfDiscoveryRecord {
  return buildScanOcsfRecord({ asserts }, timing);
}

function mentionAssertUri(mentionId: string): string {
  return `dp:scan/entity/${mentionId}`;
}

function dataItemAssertUri(dataItemId: string): string {
  return `dp:scan/entity/${dataItemId}`;
}

function resolveLandTiming(options?: LandScanDiscoveryOcsfOptions): {
  assertedAt: string;
  landDate: string;
} {
  const assertedAt = options?.assertedAt ?? PINNED_SCAN_ASSERTED_AT;
  const landDate = options?.landDate ?? landDateFromAssertedAt(assertedAt);
  return { assertedAt, landDate };
}

function sourceLocationKey(location: ScanDiscoverySourceLocation): string {
  return `${location.filePath}\0${location.startLine}\0${location.endLine}`;
}

function compareSourceLocations(
  a: ScanDiscoverySourceLocation,
  b: ScanDiscoverySourceLocation,
): number {
  const pathCompare = a.filePath.localeCompare(b.filePath);
  if (pathCompare !== 0) {
    return pathCompare;
  }
  if (a.startLine !== b.startLine) {
    return a.startLine - b.startLine;
  }
  return a.endLine - b.endLine;
}

function collectFlowSourceLocations(
  flow: ScanDiscoveryInput["dataFlows"][number],
): ScanDiscoverySourceLocation[] {
  const raw: ScanDiscoverySourceLocation[] = [];
  if (flow.sourceLocation !== undefined) {
    raw.push(flow.sourceLocation);
  }
  if (flow.sourceLocations !== undefined) {
    raw.push(...flow.sourceLocations);
  }

  const seen = new Set<string>();
  const deduped: ScanDiscoverySourceLocation[] = [];
  for (const location of raw) {
    const key = sourceLocationKey(location);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(location);
  }

  return deduped.sort(compareSourceLocations);
}

export function landPersonalDataToOcsfRecords(
  input: PersonalDataLandInput,
  options?: LandScanDiscoveryOcsfOptions,
): OcsfDiscoveryRecord[] {
  const timing = resolveLandTiming(options);
  const records: OcsfDiscoveryRecord[] = [];

  for (const mention of input.mentions) {
    const mentionUri = mentionAssertUri(mention.id);
    records.push(entityRecord(mentionUri, timing));
    records.push(slotRecord(mentionUri, "file_path", mention.filePath, timing));
    records.push(slotRecord(mentionUri, "start_line", String(mention.startLine), timing));
    records.push(slotRecord(mentionUri, "end_line", String(mention.endLine), timing));
    if (mention.code !== undefined) {
      records.push(slotRecord(mentionUri, "code", mention.code, timing));
    }
  }

  for (const dataItem of input.dataItems) {
    const dataItemUri = dataItemAssertUri(dataItem.id);
    records.push(entityRecord(dataItemUri, timing));
    records.push(slotRecord(dataItemUri, "mention", dataItem.mentionId, timing));
  }

  return records;
}

export function landScanDiscoveryToOcsfRecords(
  input: ScanDiscoveryInput,
  options?: LandScanDiscoveryOcsfOptions,
): OcsfDiscoveryRecord[] {
  const timing = resolveLandTiming(options);
  const records: OcsfDiscoveryRecord[] = [];
  const componentDataItemIds = new Map<string, string[]>(
    input.components.map((row) => [row.id, [] as string[]]),
  );

  for (const component of input.components) {
    const asserts = `dp:scan/entity/${component.id}`;
    records.push(entityRecord(asserts, timing));
    records.push(slotRecord(asserts, "name", component.name, timing));
    records.push(slotRecord(asserts, "type", component.type, timing));
    records.push(slotRecord(asserts, "sub_type", component.subType, timing));
    records.push(slotRecord(asserts, "confidence", String(component.confidence), timing));
    records.push(
      slotRecord(asserts, "source_locations", JSON.stringify(component.sourceLocations), timing),
    );
  }

  for (const flow of input.dataFlows) {
    const asserts = `dp:scan/entity/${flow.id}`;
    records.push(entityRecord(asserts, timing));
    records.push(slotRecord(asserts, "source_component", flow.sourceComponentId, timing));
    records.push(slotRecord(asserts, "target_component", flow.targetComponentId, timing));
    records.push(slotRecord(asserts, "type", flow.type, timing));
    records.push(slotRecord(asserts, "confidence", String(flow.confidence), timing));
    if (flow.targetScope !== undefined) {
      records.push(slotRecord(asserts, "target_scope", flow.targetScope, timing));
    }

    const flowSourceLocations = collectFlowSourceLocations(flow);
    for (const [index, location] of flowSourceLocations.entries()) {
      const mentionId = `mention:${flow.id}:${index}`;
      const dataItemId = `data_item:${flow.id}:${index}`;
      const mentionUri = mentionAssertUri(mentionId);
      const dataItemUri = dataItemAssertUri(dataItemId);
      const { filePath, startLine, endLine, code } = location;

      records.push(entityRecord(mentionUri, timing));
      records.push(slotRecord(mentionUri, "file_path", filePath, timing));
      records.push(slotRecord(mentionUri, "start_line", String(startLine), timing));
      records.push(slotRecord(mentionUri, "end_line", String(endLine), timing));
      if (code !== undefined) {
        records.push(slotRecord(mentionUri, "code", code, timing));
      }

      records.push(entityRecord(dataItemUri, timing));
      records.push(slotRecord(dataItemUri, "mention", mentionId, timing));

      const sourceItems = componentDataItemIds.get(flow.sourceComponentId);
      if (sourceItems) {
        sourceItems.push(dataItemId);
      }
    }
  }

  for (const component of input.components) {
    const asserts = `dp:scan/entity/${component.id}`;
    const dataItemIds = componentDataItemIds.get(component.id) ?? [];
    records.push(slotRecord(asserts, "data_item_ids", JSON.stringify(dataItemIds), timing));
  }

  return records;
}

/** @deprecated Use {@link landScanDiscoveryToOcsfRecords} */
export function landDiscoverySeedToOcsfRecords(
  input: ScanDiscoveryInput,
  options?: LandScanDiscoveryOcsfOptions,
): OcsfDiscoveryRecord[] {
  return landScanDiscoveryToOcsfRecords(input, options);
}

export { PINNED_SCAN_ASSERTED_AT, PINNED_SCAN_LAND_DATE };
