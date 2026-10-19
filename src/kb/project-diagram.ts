import fs from "fs";

import type { A0DiscoveriesDocument } from "../discoveries/contract/discoveries-document.schema";
import { loadKbState, type KbPaths } from "./kb-store";

/**
 * Project the KB (scan + interview Discoveries) into the DiagramGraphJson the
 * viewer renders. Diagrams are projections of KB facts (c4-from-kb.md): nothing
 * here is stored back, and every label traces to a Discovery.
 */
const NODE_TYPE: Record<string, string> = {
  asset: "asset",
  actor: "actor",
  third_party: "third_party_service",
};

const RAW_ID_SEPARATOR = "::";

export interface KbDiagramWrapper {
  schemaVersion: "1.0";
  graph: {
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
    viewport: { x: number; y: number; zoom: number };
  };
  metadata: Record<string, unknown>;
}

function humanize(token: string): string {
  return token.replace(/_/g, " ");
}

export function projectKbDiagram(
  document: A0DiscoveriesDocument,
  options: { projectName?: string; interviewAnswerCount?: number; orphanCount?: number } = {},
): KbDiagramWrapper {
  // With a single scan path the raw scan ids are unique; keep them so ids in the
  // diagram, the brief and diagram-ctl focus commands all match.
  const scanPaths = new Set(document.components.map((c) => c.scanPath ?? ""));
  const displayId = (id: string) => {
    if (scanPaths.size > 1) return id;
    const at = id.lastIndexOf(RAW_ID_SEPARATOR);
    return at === -1 ? id : id.slice(at + RAW_ID_SEPARATOR.length);
  };

  const inScope = document.system?.in_scope;
  const projectName = options.projectName || "System";
  const nodes: Array<Record<string, unknown>> = [
    {
      id: "system",
      type: "system",
      position: { x: 0, y: 0 },
      data: {
        label: inScope ? projectName : `${projectName} (?)`,
        description: inScope ?? "Scope not yet confirmed",
        c4Kind: "system",
        privacy: { slotStatus: inScope ? "known" : "unknown", openSlots: inScope ? [] : ["in_scope"] },
      },
    },
  ];

  for (const component of document.components) {
    const type = NODE_TYPE[component.type] ?? "asset";
    const isActor = component.type === "actor";
    const actorKnown = isActor && Boolean(component.actor_kind);
    nodes.push({
      id: displayId(component.id),
      type,
      position: { x: 0, y: 0 },
      data: {
        label: isActor && !actorKnown ? `${component.name} (?)` : component.name,
        ...(isActor && component.actor_kind ? { description: `Person (${component.actor_kind})` } : {}),
        componentType: component.type,
        componentSubType: component.subType,
        scanConfidence: component.confidence,
        sourceLocations: component.sourceLocations,
        ...(isActor ? { actor_kind: component.actor_kind ?? null } : {}),
        privacy: isActor
          ? { slotStatus: actorKnown ? "known" : "unknown", openSlots: actorKnown ? [] : ["actor_kind"] }
          : {},
      },
    });
  }

  const edges: Array<Record<string, unknown>> = [];
  for (const flow of document.dataFlows) {
    if (flow.sourceComponentId === flow.targetComponentId) continue;
    const categories = flow.data_categories ?? null;
    const purpose = flow.purpose ?? null;
    const openSlots = [...(categories ? [] : ["data_categories"]), ...(purpose ? [] : ["purpose"])];
    const flowId = displayId(flow.id);
    edges.push({
      id: flowId,
      source: displayId(flow.sourceComponentId),
      target: displayId(flow.targetComponentId),
      type: "data_flow",
      data: {
        label: humanize(flow.type),
        privacy: {
          flowId,
          dataCategories: categories,
          purpose,
          categoriesStatus: categories ? "known" : "unknown",
          purposeStatus: purpose ? "known" : "unknown",
          slotStatus: openSlots.length === 0 ? "known" : openSlots.length === 2 ? "unknown" : "partial",
          openSlots,
        },
        properties: { engineering: { flowType: humanize(flow.type), flowKind: "sends_data_to" } },
      },
    });
  }

  return {
    schemaVersion: "1.0",
    graph: { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } },
    metadata: {
      projectName,
      componentsCount: document.components.length,
      dataFlowsCount: document.dataFlows.length,
      kbProjection: {
        interviewAnswers: options.interviewAnswerCount ?? 0,
        orphanedAnswers: options.orphanCount ?? 0,
      },
    },
  };
}

function projectNameFromScan(paths: KbPaths): string | undefined {
  try {
    const dataflow = JSON.parse(fs.readFileSync(`${paths.root}/dataflow.json`, "utf8")) as {
      metadata?: { projectName?: string };
    };
    return dataflow.metadata?.projectName;
  } catch {
    return undefined;
  }
}

export interface ProjectedKbDiagram {
  path: string;
  wrapper: KbDiagramWrapper;
}

export function writeKbDiagram(paths: KbPaths, options: { projectName?: string } = {}): ProjectedKbDiagram {
  const state = loadKbState(paths);
  const wrapper = projectKbDiagram(state.document, {
    projectName: options.projectName ?? projectNameFromScan(paths),
    interviewAnswerCount: state.records.filter((r) => r.dataparade.source === "interview").length,
    orphanCount: state.orphans.length,
  });
  fs.writeFileSync(paths.diagramPath, `${JSON.stringify(wrapper, null, 2)}\n`, "utf8");
  return { path: paths.diagramPath, wrapper };
}

/** Send the projection to every open viewer tab through the diagram bridge. */
export async function pushKbDiagram(
  wrapper: KbDiagramWrapper,
  host = "http://localhost:3001",
): Promise<{ ok: boolean; broadcastToClients?: number; error?: string }> {
  const url = `${host.replace(/\/$/, "")}/api/diagram-bridge`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "load_graph", graph: wrapper }),
    });
    const body = (await response.json()) as { broadcastToClients?: number; error?: string };
    return response.ok ? { ok: true, broadcastToClients: body.broadcastToClients } : { ok: false, error: body.error };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
