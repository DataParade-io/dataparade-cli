import type { DetectedComponent } from "../core/types/component";
import type { DataFlowType, DetectedDataFlow } from "../core/types/data-flow";
import type { RawFinding } from "../core/types/detection";

function getSectionIdFromMaybeUnknown(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v ? v : undefined;
}

function getSectionIdFromComponent(
  component: DetectedComponent,
): string | undefined {
  return getSectionIdFromMaybeUnknown(component.properties?.section_id);
}

function inferTargetScope(
  sourceComponent: DetectedComponent,
  targetComponent: DetectedComponent,
): {
  targetScope: "local" | "cross_section_internal" | "external" | "unknown";
  targetScopeConfidence: "high" | "medium" | "low";
  targetScopeReason: string;
} {
  if (targetComponent.type === "third_party") {
    return {
      targetScope: "external",
      targetScopeConfidence: "high",
      targetScopeReason: "third-party-target",
    };
  }

  const sourceSectionId = getSectionIdFromComponent(sourceComponent);
  const targetSectionId = getSectionIdFromComponent(targetComponent);

  if (!sourceSectionId || !targetSectionId) {
    return {
      targetScope: "unknown",
      targetScopeConfidence: "low",
      targetScopeReason: "missing-section-id",
    };
  }

  if (sourceSectionId === targetSectionId) {
    return {
      targetScope: "local",
      targetScopeConfidence: "high",
      targetScopeReason: "same-section-id",
    };
  }

  return {
    targetScope: "cross_section_internal",
    targetScopeConfidence: "high",
    targetScopeReason: "different-section-id",
  };
}

export function flowTypeForExternalApi(finding: RawFinding): DataFlowType {
  const method =
    typeof finding.properties?.httpMethod === "string"
      ? (finding.properties.httpMethod as string).toUpperCase()
      : "";
  const url =
    typeof finding.properties?.url === "string"
      ? (finding.properties.url as string).toLowerCase()
      : "";
  if (url && (url.includes("webhook") || url.includes("callback"))) {
    return "webhook";
  }
  if (method === "POST" && url && (url.includes("hook") || url.includes("event"))) {
    return "webhook";
  }
  return "api_call";
}

export function buildFlow(
  sourceId: string,
  targetId: string,
  type: DataFlowType,
  finding: RawFinding,
  index: number,
  sourceComponent: DetectedComponent,
  targetComponent: DetectedComponent,
): DetectedDataFlow {
  const method =
    typeof finding.properties?.httpMethod === "string"
      ? finding.properties.httpMethod
      : undefined;
  const endpoint =
    typeof finding.properties?.url === "string"
      ? finding.properties.url
      : undefined;
  const scope = inferTargetScope(sourceComponent, targetComponent);
  return {
    id: `flow_${index}`,
    sourceComponentId: sourceId,
    targetComponentId: targetId,
    type,
    confidence: typeof finding.confidence === "number" ? finding.confidence : 0.8,
    sourceLocation: finding.location,
    method: method ?? undefined,
    endpoint: endpoint ?? undefined,
    targetScope: scope.targetScope,
    targetScopeConfidence: scope.targetScopeConfidence,
    targetScopeReason: scope.targetScopeReason,
  };
}

