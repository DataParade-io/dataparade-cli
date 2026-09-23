import type { ScanResult } from "../core/types/result";
import type { ScanDiscoveryInput, ScanDiscoverySourceLocation } from "./scan-discovery-input";

function mapSourceLocation(
  location: NonNullable<ScanResult["dataFlows"][number]["sourceLocation"]>,
): ScanDiscoverySourceLocation {
  return {
    filePath: location.filePath,
    startLine: location.startLine,
    endLine: location.endLine,
    ...(location.code !== undefined ? { code: location.code } : {}),
  };
}

export function scanResultToDiscoveryInput(scanResult: ScanResult): ScanDiscoveryInput {
  return {
    components: scanResult.components.map((component) => ({
      id: component.id,
      name: component.name,
      type: component.type,
      subType: component.subType ?? "",
      confidence: component.confidence,
      sourceLocations: component.sourceLocations.map((location) => ({
        filePath: location.filePath,
        startLine: location.startLine,
        endLine: location.endLine,
        ...(location.code !== undefined ? { code: location.code } : {}),
      })),
    })),
    dataFlows: scanResult.dataFlows.map((flow) => ({
      id: flow.id,
      sourceComponentId: flow.sourceComponentId,
      targetComponentId: flow.targetComponentId,
      type: flow.type,
      confidence: flow.confidence,
      ...(flow.targetScope !== undefined ? { targetScope: flow.targetScope } : {}),
      ...(flow.sourceLocation !== undefined
        ? { sourceLocation: mapSourceLocation(flow.sourceLocation) }
        : {}),
      ...(flow.sourceLocations !== undefined && flow.sourceLocations.length > 0
        ? { sourceLocations: flow.sourceLocations.map(mapSourceLocation) }
        : {}),
    })),
  };
}
