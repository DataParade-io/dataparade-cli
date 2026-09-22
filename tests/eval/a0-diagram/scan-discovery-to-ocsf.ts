import {
  PINNED_OCSF_BASE_VERSION,
  PINNED_OCSF_EXTENSION_NAME,
  PINNED_OCSF_EXTENSION_VERSION,
  OCSF_ARCHITECTURE_CATEGORY_UID,
  OCSF_ARCHITECTURE_DISCOVERY_CLASS_UID,
  OCSF_ARCHITECTURE_DISCOVERY_TYPE_UID,
} from "../interview-a0/ocsf-pins";
import { PINNED_ONTOLOGY_VERSION } from "../interview-a0/pins";
import type { OcsfDiscoveryRecord } from "../interview-a0/ocsf-discovery-types";
import type { DiscoverySeed } from "./load-discovery-seed";
import { PINNED_SCAN_ASSERTED_AT, PINNED_SCAN_LAND_DATE } from "./scan-ocsf-pins";

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

function scanDiscoveryUid(asserts: string, slot?: string): string {
  const entityPart = asserts.replace(/^dp:/, "dp_").replace(/\//g, "_").replace(/:/g, "_");
  const slotPart = slot ?? "entity";
  return `dp:discovery/scan/${entityPart}/${slotPart}/${PINNED_SCAN_LAND_DATE}`;
}

function buildScanOcsfRecord(params: {
  asserts: string;
  assertedSlot?: string;
  assertedValue?: string;
}): OcsfDiscoveryRecord {
  const entityId = parseAssertedEntityId(params.asserts);
  const uid = scanDiscoveryUid(params.asserts, params.assertedSlot);

  return {
    class_name: "Architecture Discovery",
    class_uid: OCSF_ARCHITECTURE_DISCOVERY_CLASS_UID,
    category_name: "Architecture",
    category_uid: OCSF_ARCHITECTURE_CATEGORY_UID,
    activity_id: 1,
    activity_name: "Create",
    type_uid: OCSF_ARCHITECTURE_DISCOVERY_TYPE_UID,
    time: toUnixSeconds(PINNED_SCAN_ASSERTED_AT),
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
      asserted_at: PINNED_SCAN_ASSERTED_AT,
      asserts: params.asserts,
      ...(params.assertedSlot ? { asserted_slot: params.assertedSlot } : {}),
      ...(params.assertedValue !== undefined ? { asserted_value: params.assertedValue } : {}),
      related_resource_refs: entityId ? [entityId] : undefined,
    },
  };
}

function slotRecord(asserts: string, slot: string, value: string): OcsfDiscoveryRecord {
  return buildScanOcsfRecord({ asserts, assertedSlot: slot, assertedValue: value });
}

function entityRecord(asserts: string): OcsfDiscoveryRecord {
  return buildScanOcsfRecord({ asserts });
}

function mentionAssertUri(flowId: string): string {
  return `dp:scan/entity/mention:${flowId}`;
}

function dataItemAssertUri(flowId: string): string {
  return `dp:scan/entity/data_item:${flowId}`;
}

export function landDiscoverySeedToOcsfRecords(seed: DiscoverySeed): OcsfDiscoveryRecord[] {
  const records: OcsfDiscoveryRecord[] = [];
  const componentDataItemIds = new Map<string, string[]>(
    seed.components.map((row) => [row.id, [] as string[]]),
  );

  for (const component of seed.components) {
    const asserts = `dp:scan/entity/${component.id}`;
    records.push(entityRecord(asserts));
    records.push(slotRecord(asserts, "name", component.name));
    records.push(slotRecord(asserts, "type", component.type));
    records.push(slotRecord(asserts, "sub_type", component.subType));
    records.push(slotRecord(asserts, "confidence", String(component.confidence)));
    records.push(
      slotRecord(asserts, "source_locations", JSON.stringify(component.sourceLocations)),
    );
  }

  for (const flow of seed.dataFlows) {
    const asserts = `dp:scan/entity/${flow.id}`;
    records.push(entityRecord(asserts));
    records.push(slotRecord(asserts, "source_component", flow.sourceComponentId));
    records.push(slotRecord(asserts, "target_component", flow.targetComponentId));
    records.push(slotRecord(asserts, "type", flow.type));
    records.push(slotRecord(asserts, "confidence", String(flow.confidence)));
    if (flow.targetScope !== undefined) {
      records.push(slotRecord(asserts, "target_scope", flow.targetScope));
    }

    if (flow.sourceLocation !== undefined) {
      const mentionUri = mentionAssertUri(flow.id);
      const dataItemUri = dataItemAssertUri(flow.id);
      const mentionId = `mention:${flow.id}`;
      const dataItemId = `data_item:${flow.id}`;
      const { filePath, startLine, endLine, code } = flow.sourceLocation;

      records.push(entityRecord(mentionUri));
      records.push(slotRecord(mentionUri, "file_path", filePath));
      records.push(slotRecord(mentionUri, "start_line", String(startLine)));
      records.push(slotRecord(mentionUri, "end_line", String(endLine)));
      if (code !== undefined) {
        records.push(slotRecord(mentionUri, "code", code));
      }

      records.push(entityRecord(dataItemUri));
      records.push(slotRecord(dataItemUri, "mention", mentionId));

      const sourceItems = componentDataItemIds.get(flow.sourceComponentId);
      if (sourceItems) {
        sourceItems.push(dataItemId);
      }
    }
  }

  for (const component of seed.components) {
    const asserts = `dp:scan/entity/${component.id}`;
    const dataItemIds = componentDataItemIds.get(component.id) ?? [];
    records.push(slotRecord(asserts, "data_item_ids", JSON.stringify(dataItemIds)));
  }

  return records;
}
