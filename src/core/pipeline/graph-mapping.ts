import type {
  DetectedComponent,
  DetectedDataFlow,
  ScanResult,
} from "../types";
import type { SourceLocation } from "../types/file";
import {
  diagramGraphJsonSchema,
  type DiagramGraphJsonSchema,
  type DiagramNodeSchema,
  type DiagramEdgeSchema,
  type NodeDataSchema,
} from "../schema";
import { applyAppSectionStackLayout } from "./diagram-layout/app-section-layout";
import {
  NODE_HORIZONTAL_SPACING,
  NODE_VERTICAL_SPACING,
  NODES_PER_ROW,
  SECTION_BLOCK_WIDTH,
} from "./diagram-layout/constants";
import { applyDirectionalEdgeHandles } from "./diagram-layout/edge-handles";
import { repositionManagedProviderNodes } from "./diagram-layout/managed-provider-layout";
import { applyTerraformMinimalServiceDiagramLayout } from "./diagram-layout/minimal-terraform-layout";
import {
  componentSortKey,
  getSectionIdFromComponent,
  getSectionLabelFromComponent,
} from "./diagram-layout/section-helpers";
import { applyTerraformLaneLayout } from "./diagram-layout/terraform-lane-layout";
import type { ComponentByIdMap } from "./diagram-layout/types";
import {
  isMixedAppTerraformScan,
  shouldUseTerraformMinimalServiceDiagramLayout,
} from "./terraform-minimal-services";
import { inferDataFlowProtocol } from "./infer-data-flow-protocol";

function stripCodeFromSourceLocation(
  loc: SourceLocation | undefined,
): SourceLocation | undefined {
  if (!loc) return undefined;
  const { code: _code, ...rest } = loc;
  return rest;
}

function stripCodeFromDetectedFromRef(
  ref: { pattern: string; sourceLocation?: SourceLocation },
): { pattern: string; sourceLocation?: SourceLocation } {
  return {
    pattern: ref.pattern,
    sourceLocation: stripCodeFromSourceLocation(ref.sourceLocation),
  };
}

function stripCodeFromSourceLocationsArray(
  locs: SourceLocation[] | undefined,
): SourceLocation[] | undefined {
  if (!locs) return undefined;
  return locs
    .map((l) => stripCodeFromSourceLocation(l))
    .filter((l): l is SourceLocation => l !== undefined);
}

function stripCodeFromSourceLocationsField(value: unknown): unknown {
  if (!value) return value;
  if (typeof value === "object" && !Array.isArray(value)) {
    const loc = value as { code?: unknown };
    const { code: _code, ...rest } = loc;
    return rest;
  }
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v !== "object" || v === null) return v;
        const loc = v as { code?: unknown };
        const { code: _code, ...rest } = loc;
        return rest;
      })
      .filter((v) => v !== undefined);
  }
  return value;
}

function mapComponentTypeToNodeType(type: DetectedComponent["type"]): string {
  switch (type) {
    case "asset":
      return "asset";
    case "actor":
      return "actor";
    case "third_party":
      return "third_party_service";
    default:
      return type;
  }
}

function createNodePosition(
  sectionIndex: number,
  indexWithinSection: number,
): { x: number; y: number } {
  const row = Math.floor(indexWithinSection / NODES_PER_ROW);
  const col = indexWithinSection % NODES_PER_ROW;
  const sectionXOffset = sectionIndex * SECTION_BLOCK_WIDTH;
  return {
    x: sectionXOffset + col * NODE_HORIZONTAL_SPACING,
    y: row * NODE_VERTICAL_SPACING,
  };
}

function mapComponentToNode(
  component: DetectedComponent,
  sectionIndex: number,
  indexWithinSection: number,
): DiagramNodeSchema {
  const baseData: NodeDataSchema = {
    label: component.name,
    description: component.description,
    privacy: {},
    security: {},
    engineering: {},
  };

  (baseData as Record<string, unknown>).componentType = component.type;
  if (component.subType) {
    (baseData as Record<string, unknown>).componentSubType = component.subType;
  }
  if (typeof component.confidence === "number") {
    (baseData as Record<string, unknown>).scanConfidence = component.confidence;
  }
  if (component.detectedFrom?.length) {
    (baseData as Record<string, unknown>).detectedFrom = component.detectedFrom.map(
      (ref) => stripCodeFromDetectedFromRef(ref),
    );
  }
  if (component.sourceLocations?.length) {
    (baseData as Record<string, unknown>).sourceLocations =
      stripCodeFromSourceLocationsArray(component.sourceLocations);
  }

  for (const [key, value] of Object.entries(component.properties ?? {})) {
    if (value === undefined) continue;
    if (key === "label" || key === "description") continue;
    if (key === "privacy" || key === "security" || key === "engineering") {
      continue;
    }
    const dataRecord = baseData as Record<string, unknown>;
    if (dataRecord[key] === undefined) {
      dataRecord[key] = value;
    }
  }

  return {
    id: component.id,
    type: mapComponentTypeToNodeType(component.type),
    position: createNodePosition(sectionIndex, indexWithinSection),
    data: baseData,
  };
}

function normalizeDataFlowType(type: DetectedDataFlow["type"]): string {
  return type;
}

function normalizeTransformation(transformation?: string[] | undefined): string {
  if (!transformation || transformation.length === 0) {
    return "none";
  }
  const first = transformation[0];
  const lower = first.toLowerCase();
  if (lower.includes("anonym")) return "anonymized";
  if (lower.includes("pseudonym")) return "pseudonymized";
  if (lower.includes("aggregat")) return "aggregated";
  if (lower.includes("encrypt")) return "encrypted";
  if (lower.includes("token")) return "tokenized";
  if (lower.includes("mask")) return "masked";
  if (lower.includes("redact")) return "redacted";
  return "none";
}

function buildFlowName(
  flow: DetectedDataFlow,
  componentsById: ComponentByIdMap,
): string {
  const source = componentsById.get(flow.sourceComponentId);
  const target = componentsById.get(flow.targetComponentId);
  const sourceName = source?.name ?? flow.sourceComponentId;
  const targetName = target?.name ?? flow.targetComponentId;
  return `${sourceName} → ${targetName} (${flow.type})`;
}

function mapDataFlowToEdge(
  flow: DetectedDataFlow,
  componentsById: ComponentByIdMap,
): DiagramEdgeSchema | undefined {
  if (
    !componentsById.has(flow.sourceComponentId) ||
    !componentsById.has(flow.targetComponentId)
  ) {
    return undefined;
  }

  const name = buildFlowName(flow, componentsById);

  const engineering: Record<string, unknown> = {
    transferType: normalizeDataFlowType(flow.type),
    name,
    description: flow.description,
    frequency: "unspecified",
  };

  if (flow.actions && flow.actions.length > 0) {
    engineering.actions = flow.actions;
  }

  const protocol = inferDataFlowProtocol(flow);
  if (protocol) {
    engineering.protocol = protocol;
  }

  const privacy: Record<string, unknown> = {
    dataCategories: flow.dataCategories ?? [],
    dataSubjectCategories: flow.dataSubjectCategories,
    processingPurpose: flow.processingPurpose,
    crossBorder: false,
    adequacyDecision: false,
  };

  const security: Record<string, unknown> = {
    encryption: "none",
    transformation: normalizeTransformation(flow.transformation),
    auditLogging: false,
    riskLevel: "medium",
  };

  if (flow.enrichmentConfidence !== undefined) {
    security.enrichmentConfidence = flow.enrichmentConfidence;
  }
  if (flow.enrichmentNotes) {
    security.enrichmentNotes = flow.enrichmentNotes;
  }

  const properties: Record<string, unknown> = {
    engineering,
    privacy,
    security,
  };

  const flowEntries = Object.entries(flow) as [string, unknown][];
  for (const [key, value] of flowEntries) {
    if (value === undefined) continue;
    if (key in properties) continue;
    if (key === "id" || key === "sourceComponentId" || key === "targetComponentId") {
      continue;
    }
    if (key === "type") continue;
    if (!(key in properties)) {
      if (key === "sourceLocation" || key === "sourceLocations") {
        properties[key] = stripCodeFromSourceLocationsField(value);
      } else {
        properties[key] = value;
      }
    }
  }

  const edge: DiagramEdgeSchema = {
    id: flow.id,
    source: flow.sourceComponentId,
    target: flow.targetComponentId,
    type: "data_flow",
    data: {
      label: name,
      properties,
    },
  };

  applyDirectionalEdgeHandles(
    edge,
    componentsById.get(flow.sourceComponentId),
    componentsById.get(flow.targetComponentId),
  );

  return edge;
}

/**
 * Build a `DiagramGraphJson` from a validated `ScanResult`.
 */
export function buildDiagramGraphFromScanResult(
  scanResult: ScanResult,
): DiagramGraphJsonSchema {
  const componentsById: ComponentByIdMap = new Map(
    scanResult.components.map((component) => [component.id, component]),
  );

  const buckets = new Map<
    string,
    { label: string; components: DetectedComponent[] }
  >();
  for (const component of scanResult.components) {
    const sectionId = getSectionIdFromComponent(component);
    const entry =
      buckets.get(sectionId) ??
      ({
        label: getSectionLabelFromComponent(component),
        components: [],
      });
    entry.components.push(component);
    buckets.set(sectionId, entry);
  }

  const sectionIds = Array.from(buckets.keys());
  const mixedAppWithTerraform = isMixedAppTerraformScan(scanResult.components);
  sectionIds.sort((a, b) => {
    if (mixedAppWithTerraform) {
      if (a === "root" && b !== "root") return 1;
      if (b === "root" && a !== "root") return -1;
    } else {
      if (a === "root" && b !== "root") return -1;
      if (b === "root" && a !== "root") return 1;
    }
    const labelA = buckets.get(a)?.label ?? a;
    const labelB = buckets.get(b)?.label ?? b;
    const labelCompare = labelA.localeCompare(labelB);
    if (labelCompare !== 0) return labelCompare;
    return a.localeCompare(b);
  });

  const nodes: DiagramNodeSchema[] = [];
  sectionIds.forEach((sectionId, sectionIndex) => {
    const bucket = buckets.get(sectionId);
    if (!bucket) return;

    const ordered = [...bucket.components].sort((c1, c2) => {
      const keyA = componentSortKey(c1);
      const keyB = componentSortKey(c2);
      if (keyA !== keyB) return keyA.localeCompare(keyB);
      const nameCompare = (c1.name ?? "").localeCompare(c2.name ?? "");
      if (nameCompare !== 0) return nameCompare;
      return c1.type.localeCompare(c2.type);
    });

    ordered.forEach((component, indexWithinSection) => {
      nodes.push(
        mapComponentToNode(component, sectionIndex, indexWithinSection),
      );
    });
  });

  const edges: DiagramEdgeSchema[] = [];

  const useMinimalTfLayout = shouldUseTerraformMinimalServiceDiagramLayout(
    scanResult.components,
  );
  if (useMinimalTfLayout) {
    applyTerraformMinimalServiceDiagramLayout(nodes, componentsById);
    repositionManagedProviderNodes(nodes, componentsById);
  } else {
    applyTerraformLaneLayout(nodes, componentsById, sectionIds);
    applyAppSectionStackLayout(nodes, componentsById, sectionIds);
    repositionManagedProviderNodes(nodes, componentsById);
  }

  for (const flow of scanResult.dataFlows) {
    const edge = mapDataFlowToEdge(flow, componentsById);
    if (edge) {
      edges.push(edge);
    }
  }

  const graph: DiagramGraphJsonSchema = {
    nodes,
    edges,
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
    },
  };

  const validation = diagramGraphJsonSchema.safeParse(graph);
  if (!validation.success) {
    const messages = validation.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid DiagramGraphJson: ${messages}`);
  }

  return validation.data;
}
