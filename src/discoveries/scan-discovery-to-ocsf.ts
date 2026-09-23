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
  ScanDiscoveryMentionInput,
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

function locationOverlapsComponentSource(
  mention: ScanDiscoveryMentionInput,
  location: ScanDiscoverySourceLocation,
): boolean {
  if (location.filePath !== mention.filePath) {
    return false;
  }
  return (
    mention.startLine >= location.startLine &&
    mention.endLine <= location.endLine
  );
}

function componentIdsForMention(
  mention: ScanDiscoveryMentionInput,
  input: ScanDiscoveryInput,
): string[] {
  const matches = input.components
    .filter((component) =>
      component.sourceLocations.some((location) =>
        locationOverlapsComponentSource(mention, location),
      ),
    )
    .map((component) => component.id);
  return [...new Set(matches)].sort((left, right) => left.localeCompare(right));
}

function componentIdsForDataItem(
  dataItemMentionIds: string[],
  mentionById: Map<string, ScanDiscoveryMentionInput>,
  input: ScanDiscoveryInput,
): string[] {
  const attached = new Set<string>();
  for (const mentionId of dataItemMentionIds) {
    const mention = mentionById.get(mentionId);
    if (!mention) {
      continue;
    }
    for (const componentId of componentIdsForMention(mention, input)) {
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
  const records: OcsfDiscoveryRecord[] = [];
  const componentDataItemIds = new Map<string, string[]>(
    input.components.map((row) => [row.id, [] as string[]]),
  );

  const mentionById = new Map(input.mentions.map((mention) => [mention.id, mention]));

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
  }

  for (const mention of input.mentions) {
    const mentionUri = mentionAssertUri(mention.id);
    records.push(entityRecord(mentionUri, timing));
    records.push(slotRecord(mentionUri, "file_path", mention.filePath, timing));
    records.push(slotRecord(mentionUri, "start_line", String(mention.startLine), timing));
    records.push(slotRecord(mentionUri, "end_line", String(mention.endLine), timing));
    if (mention.code !== undefined) {
      records.push(slotRecord(mentionUri, "code", mention.code, timing));
    }
    if (mention.labels.length > 0) {
      records.push(
        slotRecord(mentionUri, "labels", JSON.stringify(mention.labels), timing),
      );
    }
  }

  for (const dataItem of input.dataItems) {
    const dataItemUri = dataItemAssertUri(dataItem.id);
    records.push(entityRecord(dataItemUri, timing));
    records.push(
      slotRecord(dataItemUri, "mention_ids", JSON.stringify(dataItem.mentionIds), timing),
    );
    if (dataItem.labels.length > 0) {
      records.push(
        slotRecord(dataItemUri, "labels", JSON.stringify(dataItem.labels), timing),
      );
    }

    const attachedComponentIds = componentIdsForDataItem(
      dataItem.mentionIds,
      mentionById,
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
