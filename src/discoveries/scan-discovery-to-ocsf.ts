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
  ScanDiscoveryInput,
  ScanDiscoveryOccurrenceInput,
  ScanDiscoverySourceLocation,
} from "./scan-discovery-input";
import { scanEntityAsserts } from "./scan-entity-uri";
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

function occurrenceAssertUri(scanPath: string | undefined, occurrenceId: string): string {
  return scanEntityAsserts(scanPath, occurrenceId);
}

function dataItemAssertUri(scanPath: string | undefined, dataItemId: string): string {
  return scanEntityAsserts(scanPath, dataItemId);
}

function resolveLandTiming(options?: LandScanDiscoveryOcsfOptions): {
  assertedAt: string;
  landDate: string;
} {
  const assertedAt = options?.assertedAt ?? PINNED_SCAN_ASSERTED_AT;
  const landDate = options?.landDate ?? landDateFromAssertedAt(assertedAt);
  return { assertedAt, landDate };
}

function locationOverlapsComponentSource(
  occurrence: ScanDiscoveryOccurrenceInput,
  location: ScanDiscoverySourceLocation,
): boolean {
  if (location.filePath !== occurrence.filePath) {
    return false;
  }
  return (
    occurrence.startLine >= location.startLine &&
    occurrence.endLine <= location.endLine
  );
}

function componentIdsForOccurrence(
  occurrence: ScanDiscoveryOccurrenceInput,
  input: ScanDiscoveryInput,
): string[] {
  const matches = input.components
    .filter((component) =>
      component.sourceLocations.some((location) =>
        locationOverlapsComponentSource(occurrence, location),
      ),
    )
    .map((component) => component.id);
  return [...new Set(matches)].sort((left, right) => left.localeCompare(right));
}

function componentIdsForDataItem(
  dataItemOccurrenceIds: string[],
  occurrenceById: Map<string, ScanDiscoveryOccurrenceInput>,
  input: ScanDiscoveryInput,
): string[] {
  const attached = new Set<string>();
  for (const occurrenceId of dataItemOccurrenceIds) {
    const occurrence = occurrenceById.get(occurrenceId);
    if (!occurrence) {
      continue;
    }
    for (const componentId of componentIdsForOccurrence(occurrence, input)) {
      attached.add(componentId);
    }
  }
  return [...attached].sort((left, right) => left.localeCompare(right));
}

export function landScanDiscoveryToOcsfRecords(
  input: ScanDiscoveryInput,
  options?: LandScanDiscoveryOcsfOptions,
): OcsfDiscoveryRecord[] {
  const timing = resolveLandTiming(options);
  const scanPath = input.scanPath;
  const records: OcsfDiscoveryRecord[] = [];
  const componentDataItemIds = new Map<string, string[]>(
    input.components.map((row) => [row.id, [] as string[]]),
  );

  const occurrenceById = new Map(input.occurrences.map((occurrence) => [occurrence.id, occurrence]));

  for (const component of input.components) {
    const asserts = scanEntityAsserts(scanPath, component.id);
    records.push(entityRecord(asserts, timing));
    if (scanPath) {
      records.push(slotRecord(asserts, "scan_path", scanPath, timing));
    }
    records.push(slotRecord(asserts, "name", component.name, timing));
    records.push(slotRecord(asserts, "type", component.type, timing));
    records.push(slotRecord(asserts, "sub_type", component.subType, timing));
    records.push(slotRecord(asserts, "confidence", String(component.confidence), timing));
    records.push(
      slotRecord(asserts, "source_locations", JSON.stringify(component.sourceLocations), timing),
    );
  }

  for (const flow of input.dataFlows) {
    const asserts = scanEntityAsserts(scanPath, flow.id);
    records.push(entityRecord(asserts, timing));
    if (scanPath) {
      records.push(slotRecord(asserts, "scan_path", scanPath, timing));
    }
    records.push(slotRecord(asserts, "source_component", flow.sourceComponentId, timing));
    records.push(slotRecord(asserts, "target_component", flow.targetComponentId, timing));
    records.push(slotRecord(asserts, "type", flow.type, timing));
    records.push(slotRecord(asserts, "confidence", String(flow.confidence), timing));
    if (flow.targetScope !== undefined) {
      records.push(slotRecord(asserts, "target_scope", flow.targetScope, timing));
    }
  }

  for (const occurrence of input.occurrences) {
    const occurrenceUri = occurrenceAssertUri(scanPath, occurrence.id);
    records.push(entityRecord(occurrenceUri, timing));
    if (scanPath) {
      records.push(slotRecord(occurrenceUri, "scan_path", scanPath, timing));
    }
    records.push(slotRecord(occurrenceUri, "file_path", occurrence.filePath, timing));
    records.push(slotRecord(occurrenceUri, "start_line", String(occurrence.startLine), timing));
    records.push(slotRecord(occurrenceUri, "end_line", String(occurrence.endLine), timing));
    if (occurrence.code !== undefined) {
      records.push(slotRecord(occurrenceUri, "code", occurrence.code, timing));
    }
    if (occurrence.labels.length > 0) {
      records.push(
        slotRecord(occurrenceUri, "labels", JSON.stringify(occurrence.labels), timing),
      );
    }
  }

  for (const dataItem of input.dataItems) {
    const dataItemUri = dataItemAssertUri(scanPath, dataItem.id);
    records.push(entityRecord(dataItemUri, timing));
    if (scanPath) {
      records.push(slotRecord(dataItemUri, "scan_path", scanPath, timing));
    }
    records.push(
      slotRecord(dataItemUri, "occurrence_ids", JSON.stringify(dataItem.occurrenceIds), timing),
    );
    if (dataItem.labels.length > 0) {
      records.push(
        slotRecord(dataItemUri, "labels", JSON.stringify(dataItem.labels), timing),
      );
    }

    const attachedComponentIds = componentIdsForDataItem(
      dataItem.occurrenceIds,
      occurrenceById,
      input,
    );
    for (const componentId of attachedComponentIds) {
      const sourceItems = componentDataItemIds.get(componentId);
      if (sourceItems) {
        sourceItems.push(dataItem.id);
      }
    }
  }

  for (const component of input.components) {
    const asserts = scanEntityAsserts(scanPath, component.id);
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
