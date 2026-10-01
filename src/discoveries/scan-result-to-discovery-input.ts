import type { OrchestratorScanResult } from "../core/pipeline/orchestrator-result";
import type { ScanResult } from "../core/types/result";
import type { ScanDiscoveryInput } from "./scan-discovery-input";

export interface DiscoverySeedLike {
  components: ScanDiscoveryInput["components"];
  dataFlows: Array<
    ScanDiscoveryInput["dataFlows"][number] & {
      sourceLocation?: ScanDiscoveryInput["components"][number]["sourceLocations"][number];
      sourceLocations?: ScanDiscoveryInput["components"][number]["sourceLocations"];
    }
  >;
}

export function discoverySeedToDiscoveryInput(seed: DiscoverySeedLike): ScanDiscoveryInput {
  return {
    components: seed.components,
    dataFlows: seed.dataFlows.map(
      ({ sourceLocation: _sourceLocation, sourceLocations: _sourceLocations, ...flow }) => flow,
    ),
    occurrences: [],
    dataItems: [],
  };
}

export function scanResultToDiscoveryInput(
  scanResult: ScanResult,
  personalData: Pick<OrchestratorScanResult, "occurrences" | "dataItems"> = {
    occurrences: [],
    dataItems: [],
  },
): ScanDiscoveryInput {
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
    })),
    occurrences: personalData.occurrences.map((occurrence) => ({
      id: occurrence.id,
      filePath: occurrence.filePath,
      startLine: occurrence.startLine,
      endLine: occurrence.endLine,
      labels: [...occurrence.labels],
      ...(occurrence.code !== undefined ? { code: occurrence.code } : {}),
    })),
    dataItems: personalData.dataItems.map((dataItem) => ({
      id: dataItem.id,
      occurrenceIds: [...dataItem.occurrenceIds],
      labels: [...dataItem.labels],
    })),
  };
}

export function orchestratorScanResultToDiscoveryInput(
  result: OrchestratorScanResult,
): ScanDiscoveryInput {
  return scanResultToDiscoveryInput(result.scanResult, {
    occurrences: result.occurrences ?? [],
    dataItems: result.dataItems ?? [],
  });
}
