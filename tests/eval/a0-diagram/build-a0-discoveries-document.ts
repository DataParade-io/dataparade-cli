import type { DiscoverySeed } from "./load-discovery-seed";
import {
  discoveryValue,
  indexDiscoverySlots,
  type LoadedOcsfDiscoveries,
} from "./load-ocsf-discoveries";
import {
  type A0DiscoveriesDocument,
  validateA0DiscoveriesDocument,
} from "./a0-discoveries-document.schema";

export interface BuildA0DiscoveriesDocumentInput {
  seed: DiscoverySeed;
  discoveries?: LoadedOcsfDiscoveries;
}

function parseCategoriesValue(raw: string | undefined): string[] | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(String);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function mentionIdForFlow(flowId: string): string {
  return `mention:${flowId}`;
}

function dataItemIdForFlow(flowId: string): string {
  return `data_item:${flowId}`;
}

export function buildA0DiscoveriesDocument(
  input: BuildA0DiscoveriesDocumentInput,
): A0DiscoveriesDocument {
  const discoveryIndex = indexDiscoverySlots(input.discoveries?.records ?? []);
  const seedComponentIds = new Set(input.seed.components.map((row) => row.id));
  const seedFlowIds = new Set(input.seed.dataFlows.map((row) => row.id));

  const componentDataItemIds = new Map<string, string[]>(
    input.seed.components.map((row) => [row.id, [] as string[]]),
  );

  const mentions: A0DiscoveriesDocument["mentions"] = [];
  const dataItems: A0DiscoveriesDocument["dataItems"] = [];

  const components = input.seed.components.map((row) => {
    const asserts = `dp:scan/entity/${row.id}`;
    const actorKind = discoveryValue(discoveryIndex, asserts, "actor_kind");
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      subType: row.subType,
      confidence: row.confidence,
      sourceLocations: row.sourceLocations,
      dataItemIds: componentDataItemIds.get(row.id) ?? [],
      ...(actorKind ? { actor_kind: actorKind } : {}),
    };
  });

  const dataFlows = input.seed.dataFlows.map((flow) => {
    const asserts = `dp:scan/entity/${flow.id}`;
    const categoriesRaw = discoveryValue(discoveryIndex, asserts, "data_categories");
    const purpose = discoveryValue(discoveryIndex, asserts, "purpose");
    const dataCategories = parseCategoriesValue(categoriesRaw);

    if (flow.sourceLocation !== undefined) {
      const mentionId = mentionIdForFlow(flow.id);
      const dataItemId = dataItemIdForFlow(flow.id);
      const { filePath, startLine, endLine, code } = flow.sourceLocation;

      mentions.push({
        id: mentionId,
        filePath,
        startLine,
        endLine,
        ...(code !== undefined ? { code } : {}),
      });
      dataItems.push({
        id: dataItemId,
        mentionId,
      });

      const sourceDataItemIds = componentDataItemIds.get(flow.sourceComponentId);
      if (sourceDataItemIds) {
        sourceDataItemIds.push(dataItemId);
      }
    }

    return {
      id: flow.id,
      sourceComponentId: flow.sourceComponentId,
      targetComponentId: flow.targetComponentId,
      type: flow.type,
      confidence: flow.confidence,
      ...(flow.targetScope !== undefined ? { targetScope: flow.targetScope } : {}),
      ...(dataCategories && dataCategories.length > 0 ? { data_categories: dataCategories } : {}),
      ...(purpose ? { purpose } : {}),
    };
  });

  for (const component of components) {
    component.dataItemIds = componentDataItemIds.get(component.id) ?? [];
  }

  const inScope = discoveryValue(discoveryIndex, "dp:a0/system", "in_scope");
  const document: A0DiscoveriesDocument = {
    components,
    dataFlows,
    dataItems,
    mentions,
    ...(inScope ? { system: { in_scope: inScope } } : {}),
  };

  for (const record of input.discoveries?.records ?? []) {
    const asserts = record.dataparade.asserts;
    const slot = record.dataparade.asserted_slot;
    if (!slot) {
      continue;
    }
    if (asserts.startsWith("dp:scan/entity/")) {
      const entityId = asserts.slice("dp:scan/entity/".length);
      if (!seedComponentIds.has(entityId) && !seedFlowIds.has(entityId)) {
        throw new Error(
          `OCSF overlay references ${asserts} which is not present in the discovery seed`,
        );
      }
    }
  }

  const validation = validateA0DiscoveriesDocument(document);
  if (!validation.ok) {
    throw new Error(`Invalid A0 discoveries document: ${validation.errors.join("; ")}`);
  }

  return validation.value;
}
