import type { DiagramGraphJsonSchema } from "../../../src/core/schema/diagram-graph.schema";
import type { DataflowWrapperSchema } from "../../../src/core/schema/dataflow-wrapper.schema";
import { validateDataflowJson } from "../../../src/core/schema/dataflow-wrapper.schema";
import { assertBriefSnapshotPins, componentNodeTypeFromDiscoveryType } from "./brief-graph-input";
import type { A0DiscoveriesDocument } from "./a0-discoveries-document.schema";
import { buildA0DiscoveriesDocument } from "./build-a0-discoveries-document";
import type { DiscoverySeed } from "./load-discovery-seed";

export { buildA0DiscoveriesDocument } from "./build-a0-discoveries-document";
export { projectOcsfToDiscoveriesDocument } from "./project-ocsf-to-discoveries-document";
export { landDiscoverySeedToOcsfRecords } from "./scan-discovery-to-ocsf";
export type { A0DiscoveriesDocument } from "./a0-discoveries-document.schema";
import type { LoadedOcsfDiscoveries } from "./load-ocsf-discoveries";
import type { BriefSnapshot } from "../interview-a0/types";
import { PINNED_BRIEF_SHA } from "../interview-a0/pins";

export type A0ProjectorMode = "interview" | "filled";
export type SlotStatus = "known" | "unknown" | "partial";

export class A0ProjectorError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "A0ProjectorError";
  }
}

export interface ProjectA0DiagramInput {
  briefMarkdown?: string;
  brief: BriefSnapshot;
  discoveries?: LoadedOcsfDiscoveries;
  discoverySeed: DiscoverySeed;
  discoveriesDocument?: A0DiscoveriesDocument;
  mode?: A0ProjectorMode;
  projectName?: string;
}

export interface FlowPrivacyState {
  categoriesStatus: SlotStatus;
  purposeStatus: SlotStatus;
  dataCategories: string[] | null;
  purpose: string | null;
  openSlots: string[];
  slotStatus: SlotStatus;
}

function mergeSlotStatus(parts: SlotStatus[]): SlotStatus {
  if (parts.includes("unknown")) {
    return "unknown";
  }
  if (parts.includes("partial")) {
    return "partial";
  }
  return "known";
}

function flowPrivacyState(
  flow: A0DiscoveriesDocument["dataFlows"][number],
): FlowPrivacyState {
  const dataCategories =
    flow.data_categories && flow.data_categories.length > 0 ? flow.data_categories : null;
  const purpose = flow.purpose ?? null;

  const categoriesStatus: SlotStatus =
    dataCategories && dataCategories.length > 0 ? "known" : "unknown";
  const purposeStatus: SlotStatus = purpose ? "known" : "unknown";

  const openSlots: string[] = [];
  if (categoriesStatus !== "known") {
    openSlots.push("data_categories");
  }
  if (purposeStatus !== "known") {
    openSlots.push("purpose");
  }

  return {
    categoriesStatus,
    purposeStatus,
    dataCategories,
    purpose,
    openSlots,
    slotStatus: mergeSlotStatus([categoriesStatus, purposeStatus]),
  };
}

function actorSlotStatus(
  cmpId: string,
  discoveriesDocument: A0DiscoveriesDocument,
): SlotStatus {
  const row = discoveriesDocument.components.find((component) => component.id === cmpId);
  if (!row || row.type !== "actor") {
    return "known";
  }
  if (row.actor_kind) {
    return "known";
  }
  return "unknown";
}

function systemSlotStatus(
  brief: BriefSnapshot,
  discoveriesDocument: A0DiscoveriesDocument,
): { slotStatus: SlotStatus; inScope: string | null; openSlots: string[] } {
  const inScope = discoveriesDocument.system?.in_scope ?? null;
  const openSlots: string[] = [];

  if (brief.unknownSlots.includes("system_identity") && !inScope) {
    openSlots.push("system_identity");
  }
  if (brief.unknownSlots.includes("system_boundary")) {
    openSlots.push("system_boundary");
  }

  let slotStatus: SlotStatus = "known";
  if (openSlots.length > 0 && inScope) {
    slotStatus = "partial";
  } else if (openSlots.length > 0) {
    slotStatus = "unknown";
  } else if (inScope) {
    slotStatus = "known";
  }

  return { slotStatus, inScope, openSlots };
}

function filledFlowEdgePrivacy(
  privacy: FlowPrivacyState,
  flowId: string,
): Record<string, unknown> {
  const includedStatuses: SlotStatus[] = [];
  const payload: Record<string, unknown> = {
    openSlots: [],
    flowId,
  };

  if (privacy.categoriesStatus === "known") {
    payload.categoriesStatus = "known";
    if (privacy.dataCategories) {
      payload.dataCategories = privacy.dataCategories;
    }
    includedStatuses.push("known");
  }
  if (privacy.purposeStatus === "known") {
    payload.purposeStatus = "known";
    if (privacy.purpose) {
      payload.purpose = privacy.purpose;
    }
    includedStatuses.push("known");
  }

  payload.slotStatus =
    includedStatuses.length > 0 && includedStatuses.every((status) => status === "known")
      ? "known"
      : "partial";

  return payload;
}

function filledSystemNodePrivacy(
  systemState: ReturnType<typeof systemSlotStatus>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    openSlots: [],
    source: "seed+ocsf",
  };
  const includedStatuses: SlotStatus[] = [];

  if (systemState.inScope) {
    payload.inScope = systemState.inScope;
    includedStatuses.push("known");
  }

  payload.slotStatus =
    includedStatuses.length > 0 && includedStatuses.every((status) => status === "known")
      ? "known"
      : "partial";

  return payload;
}

function filledActorNodePrivacy(
  cmpId: string,
): Record<string, unknown> {
  return {
    slotStatus: "known",
    openSlots: [],
    cmpId,
  };
}

function edgeLabel(privacy: FlowPrivacyState, filled: boolean): string {
  const categories =
    privacy.categoriesStatus === "known" && privacy.dataCategories
      ? privacy.dataCategories.join(", ")
      : filled
        ? null
        : "?";
  const purpose =
    privacy.purposeStatus === "known" && privacy.purpose ? privacy.purpose : filled ? null : "?";
  const parts = [categories, purpose].filter((part): part is string => part !== null);
  return parts.join(" | ");
}

function layoutNodes(nodeIds: string[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const cols = Math.ceil(Math.sqrt(nodeIds.length));
  nodeIds.forEach((id, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    positions.set(id, { x: 80 + col * 220, y: 120 + row * 100 });
  });
  return positions;
}

export function projectA0DiagramGraph(input: ProjectA0DiagramInput): DiagramGraphJsonSchema {
  const mode = input.mode ?? "interview";
  const filled = mode === "filled";

  assertBriefSnapshotPins(input.brief, PINNED_BRIEF_SHA);
  const discoveriesDocument =
    input.discoveriesDocument ??
    buildA0DiscoveriesDocument({
      seed: input.discoverySeed,
      discoveries: input.discoveries,
    });

  const componentById = new Map(discoveriesDocument.components.map((row) => [row.id, row]));
  const flows = discoveriesDocument.dataFlows;

  const systemState = systemSlotStatus(input.brief, discoveriesDocument);
  const nodes: DiagramGraphJsonSchema["nodes"] = [];
  const edges: DiagramGraphJsonSchema["edges"] = [];

  const involvedCmpIds = new Set<string>();
  for (const flow of flows) {
    involvedCmpIds.add(flow.sourceComponentId);
    involvedCmpIds.add(flow.targetComponentId);
  }

  const nodeIds = ["system", ...[...involvedCmpIds].sort()];
  const positions = layoutNodes(nodeIds);

  const includedNodeIds = new Set<string>();

  if (!filled || systemState.slotStatus !== "unknown") {
    const systemLabel = filled
      ? (systemState.inScope ?? "DataParade")
      : (systemState.inScope ??
        (systemState.slotStatus === "unknown" ? "DataParade (?)" : "DataParade"));

    nodes.push({
      id: "system",
      type: "system",
      position: positions.get("system") ?? { x: 400, y: 20 },
      data: {
        label: systemLabel,
        description: "A0 system-context boundary",
        privacy: filled
          ? filledSystemNodePrivacy(systemState)
          : {
              slotStatus: systemState.slotStatus,
              openSlots: systemState.openSlots,
              inScope: systemState.inScope,
              source: "seed+ocsf",
            },
      },
    });
    includedNodeIds.add("system");
  }

  for (const cmpId of [...involvedCmpIds].sort()) {
    const row = componentById.get(cmpId);
    const label = row?.name ?? cmpId;
    const actorStatus = actorSlotStatus(cmpId, discoveriesDocument);
    if (filled && actorStatus === "unknown") {
      continue;
    }

    const displayLabel =
      filled || actorStatus === "known" ? label : actorStatus === "partial" ? `${label} (partial)` : `${label} (?)`;

    nodes.push({
      id: cmpId,
      type: row ? componentNodeTypeFromDiscoveryType(row.type) : "asset",
      position: positions.get(cmpId) ?? { x: 0, y: 0 },
      data: {
        label: displayLabel,
        privacy: filled
          ? filledActorNodePrivacy(cmpId)
          : {
              slotStatus: actorStatus,
              openSlots: actorStatus === "partial" ? ["actor_kind"] : [],
              cmpId,
            },
      },
    });
    includedNodeIds.add(cmpId);
  }

  for (const flow of flows) {
    const privacy = flowPrivacyState(flow);
    if (filled && privacy.categoriesStatus === "unknown" && privacy.purposeStatus === "unknown") {
      continue;
    }
    if (
      !includedNodeIds.has(flow.sourceComponentId) ||
      !includedNodeIds.has(flow.targetComponentId)
    ) {
      continue;
    }

    const sourceLabel = componentById.get(flow.sourceComponentId)?.name ?? flow.sourceComponentId;
    const targetLabel = componentById.get(flow.targetComponentId)?.name ?? flow.targetComponentId;

    edges.push({
      id: flow.id,
      source: flow.sourceComponentId,
      target: flow.targetComponentId,
      type: "data_flow",
      data: {
        label: edgeLabel(privacy, filled),
        privacy: filled
          ? filledFlowEdgePrivacy(privacy, flow.id)
          : {
              slotStatus: privacy.slotStatus,
              openSlots: privacy.openSlots,
              categoriesStatus: privacy.categoriesStatus,
              purposeStatus: privacy.purposeStatus,
              dataCategories: privacy.dataCategories,
              purpose: privacy.purpose,
              flowId: flow.id,
            },
        narrative: `${sourceLabel} → ${targetLabel}`,
        properties: {
          engineering: { flowKind: "sends_data_to", scanProvenance: true },
        },
      },
    });
  }

  return {
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 0.75 },
  };
}

export function buildA0DiagramWrapper(input: ProjectA0DiagramInput): DataflowWrapperSchema {
  const discoveriesDocument =
    input.discoveriesDocument ??
    buildA0DiscoveriesDocument({
      seed: input.discoverySeed,
      discoveries: input.discoveries,
    });
  const graph = projectA0DiagramGraph({ ...input, discoveriesDocument });
  const wrapper: DataflowWrapperSchema = {
    schemaVersion: "1.0",
    graph,
    metadata: {
      projectName: input.projectName ?? "dogfood-a0",
      componentsCount: graph.nodes.filter((node) => node.id !== "system").length,
      dataFlowsCount: graph.edges.length,
      a0Projector: {
        mode: input.mode ?? "interview",
        briefSha: PINNED_BRIEF_SHA,
        discoveryCount: input.discoveries?.records.length ?? 0,
        discoveryDirectory: input.discoveries?.directory ?? "",
      },
    },
  };

  const validation = validateDataflowJson(wrapper);
  if (!validation.ok) {
    throw new A0ProjectorError("SCHEMA_INVALID", validation.errors.join("; "));
  }

  return validation.value;
}

/** @deprecated Use {@link buildA0DiagramWrapper} — dataflow.json is now the discoveries document. */
export function buildA0DataflowWrapper(input: ProjectA0DiagramInput): DataflowWrapperSchema {
  return buildA0DiagramWrapper(input);
}
