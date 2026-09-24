import type { DiagramGraphJsonSchema } from "../core/schema/diagram-graph.schema";
import type { A0DiscoveriesDocument } from "../../tests/eval/a0-diagram/a0-discoveries-document.schema";

export interface CollectedDiagram {
  graph: DiagramGraphJsonSchema;
  d2: string;
}

function layout(ids: string[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
  ids.forEach((id, index) => {
    positions.set(id, {
      x: 80 + (index % cols) * 240,
      y: 80 + Math.floor(index / cols) * 140,
    });
  });
  return positions;
}

function d2Id(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "");
  return safe.length > 0 ? safe : "node";
}

function localId(id: string): string {
  const marker = "::";
  const at = id.lastIndexOf(marker);
  return at === -1 ? id : id.slice(at + marker.length);
}

function pathLabel(scanPath: string | undefined): string | undefined {
  if (!scanPath) {
    return undefined;
  }
  const parts = scanPath.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? scanPath;
}

function componentLabel(component: A0DiscoveriesDocument["components"][number]): string {
  const where = pathLabel(component.scanPath);
  return where ? `${component.name} (${where})` : component.name;
}

export function projectCollectedDiscoveriesDiagram(
  document: A0DiscoveriesDocument,
): CollectedDiagram {
  const mentionById = new Map(document.mentions.map((mention) => [mention.id, mention]));
  const dataItemById = new Map(document.dataItems.map((item) => [item.id, item]));
  const componentIds = new Set(document.components.map((component) => component.id));

  const dataItemIdsOnComponents = new Set<string>();
  for (const component of document.components) {
    for (const dataItemId of component.dataItemIds) {
      dataItemIdsOnComponents.add(dataItemId);
    }
  }

  const nodeIds = [
    ...document.components.map((component) => component.id),
    ...document.dataItems
      .filter((item) => !dataItemIdsOnComponents.has(item.id))
      .map((item) => item.id),
  ];
  for (const flow of document.dataFlows) {
    if (!componentIds.has(flow.sourceComponentId)) {
      nodeIds.push(flow.sourceComponentId);
    }
    if (!componentIds.has(flow.targetComponentId)) {
      nodeIds.push(flow.targetComponentId);
    }
  }
  const uniqueNodeIds = [...new Set(nodeIds)];
  const positions = layout(uniqueNodeIds);

  const nodes: DiagramGraphJsonSchema["nodes"] = uniqueNodeIds.map((id) => {
    const component = document.components.find((row) => row.id === id);
    if (component) {
      const dataItems = component.dataItemIds
        .map((dataItemId) => dataItemById.get(dataItemId))
        .filter((item): item is NonNullable<typeof item> => item !== undefined)
        .map((item) => ({
          id: item.id,
          mentions: item.mentionIds
            .map((mentionId) => mentionById.get(mentionId))
            .filter((mention): mention is NonNullable<typeof mention> => mention !== undefined)
            .map((mention) => ({
              id: mention.id,
              filePath: mention.filePath,
              startLine: mention.startLine,
              endLine: mention.endLine,
              ...(mention.code !== undefined ? { code: mention.code } : {}),
            })),
        }));
      return {
        id,
        type: component.type || "component",
        position: positions.get(id) ?? { x: 0, y: 0 },
        data: {
          label: componentLabel(component),
          description: component.subType,
          privacy: { slotStatus: "known" as const, source: "ocsf" },
          collected: {
            scanPath: component.scanPath,
            dataItems,
          },
        },
      };
    }

    const dataItem = dataItemById.get(id);
    if (dataItem) {
      const where = pathLabel(dataItem.scanPath);
      const mentions = dataItem.mentionIds
        .map((mentionId) => mentionById.get(mentionId))
        .filter((mention): mention is NonNullable<typeof mention> => mention !== undefined);
      return {
        id,
        type: "data_item",
        position: positions.get(id) ?? { x: 0, y: 0 },
        data: {
          label: where ? `${localId(dataItem.id)} (${where})` : localId(dataItem.id),
          privacy: { slotStatus: "known" as const, source: "ocsf" },
          collected: {
            scanPath: dataItem.scanPath,
            mentions: mentions.map((mention) => ({
              id: mention.id,
              filePath: mention.filePath,
              startLine: mention.startLine,
              endLine: mention.endLine,
            })),
          },
        },
      };
    }

    return {
      id,
      type: "component",
      position: positions.get(id) ?? { x: 0, y: 0 },
      data: {
        label: id,
        privacy: { slotStatus: "known" as const, source: "ocsf" },
      },
    };
  });

  const edges: DiagramGraphJsonSchema["edges"] = document.dataFlows.map((flow) => {
    const knownBits = [
      flow.type,
      ...(flow.data_categories ?? []),
      ...(flow.purpose ? [flow.purpose] : []),
    ];
    return {
      id: flow.id,
      source: flow.sourceComponentId,
      target: flow.targetComponentId,
      type: "data_flow",
      data: {
        label: knownBits.join(" | "),
        narrative: `${flow.sourceComponentId} → ${flow.targetComponentId}`,
        privacy: { slotStatus: "known" as const, source: "ocsf" },
      },
    };
  });

  const graph: DiagramGraphJsonSchema = {
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 0.75 },
  };

  return { graph, d2: renderCollectedD2(graph) };
}

function renderCollectedD2(graph: DiagramGraphJsonSchema): string {
  const lines = ["direction: right", ""];
  const used = new Map<string, string>();
  function uniqueD2Id(id: string): string {
    const base = d2Id(id);
    let candidate = base;
    let n = 2;
    while ([...used.values()].includes(candidate)) {
      candidate = `${base}_${n}`;
      n += 1;
    }
    used.set(id, candidate);
    return candidate;
  }

  for (const node of graph.nodes) {
    const id = uniqueD2Id(node.id);
    const label = String(node.data.label ?? node.id).replace(/\n/g, " ");
    lines.push(`${id}: ${JSON.stringify(label)}`);
  }
  lines.push("");
  for (const edge of graph.edges) {
    const source = used.get(edge.source) ?? d2Id(edge.source);
    const target = used.get(edge.target) ?? d2Id(edge.target);
    const label = edge.data?.label ?? "";
    lines.push(label ? `${source} -> ${target}: ${JSON.stringify(label)}` : `${source} -> ${target}`);
  }
  return `${lines.join("\n")}\n`;
}
