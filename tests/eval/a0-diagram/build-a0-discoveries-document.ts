import { parseBriefComponents, parseBriefFlows } from "./brief-graph-input";
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
  briefMarkdown: string;
  discoveries: LoadedOcsfDiscoveries;
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

export function buildA0DiscoveriesDocument(
  input: BuildA0DiscoveriesDocumentInput,
): A0DiscoveriesDocument {
  const discoveryIndex = indexDiscoverySlots(input.discoveries.records);
  const components = parseBriefComponents(input.briefMarkdown).map((row) => {
    const asserts = `dp:scan/entity/${row.cmpId}`;
    const actorKind = discoveryValue(discoveryIndex, asserts, "actor_kind");
    return {
      id: row.cmpId,
      label: row.label,
      kind: row.kindHint,
      ...(actorKind ? { actor_kind: actorKind } : {}),
    };
  });

  const dataFlows = parseBriefFlows(input.briefMarkdown).map((flow) => {
    const asserts = `dp:scan/entity/${flow.flowId}`;
    const categoriesRaw = discoveryValue(discoveryIndex, asserts, "data_categories");
    const purpose = discoveryValue(discoveryIndex, asserts, "purpose");
    const dataCategories = parseCategoriesValue(categoriesRaw);
    return {
      id: flow.flowId,
      source: flow.sourceCmpId,
      target: flow.targetCmpId,
      ...(dataCategories && dataCategories.length > 0 ? { data_categories: dataCategories } : {}),
      ...(purpose ? { purpose } : {}),
    };
  });

  const inScope = discoveryValue(discoveryIndex, "dp:a0/system", "in_scope");
  const document: A0DiscoveriesDocument = {
    components,
    dataFlows,
    dataItems: [],
    mentions: [],
    ...(inScope ? { system: { in_scope: inScope } } : {}),
  };

  const validation = validateA0DiscoveriesDocument(document);
  if (!validation.ok) {
    throw new Error(`Invalid A0 discoveries document: ${validation.errors.join("; ")}`);
  }

  return validation.value;
}
