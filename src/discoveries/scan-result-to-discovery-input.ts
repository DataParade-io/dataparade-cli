import type { ScanResult } from "../core/types/result";
import type { ScanDiscoveryInput } from "./scan-discovery-input";

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
        ? {
            sourceLocation: {
              filePath: flow.sourceLocation.filePath,
              startLine: flow.sourceLocation.startLine,
              endLine: flow.sourceLocation.endLine,
              ...(flow.sourceLocation.code !== undefined ? { code: flow.sourceLocation.code } : {}),
            },
          }
        : {}),
    })),
  };
}
