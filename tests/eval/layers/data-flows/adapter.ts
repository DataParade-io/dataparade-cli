import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../../src/core/pipeline/orchestrator";
import type { DetectedComponent } from "../../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../../src/core/types/data-flow";
import type { SourceLocation } from "../../../../src/core/types/file";
import { componentIdentity } from "../components/adapter";
import type { FixtureScanResult, LayerFinding } from "../../types";

const FIXTURES_ROOT = path.join(__dirname, "../../../fixtures");

function collectSourceLocations(flow: DetectedDataFlow): SourceLocation[] {
  if (flow.sourceLocations && flow.sourceLocations.length > 0) {
    return flow.sourceLocations;
  }
  if (flow.sourceLocation) {
    return [flow.sourceLocation];
  }
  return [];
}

/** Edge identity aligned with benchmark subject keys: `flow:sourceKey->targetKey` */
export function dataFlowIdentity(
  flow: DetectedDataFlow,
  componentsById: Map<string, DetectedComponent>,
): string {
  const source = componentsById.get(flow.sourceComponentId);
  const target = componentsById.get(flow.targetComponentId);
  const sourceKey = source ? componentIdentity(source) : flow.sourceComponentId;
  const targetKey = target ? componentIdentity(target) : flow.targetComponentId;
  return `flow:${sourceKey}->${targetKey}`;
}

function toLayerFinding(
  flow: DetectedDataFlow,
  componentsById: Map<string, DetectedComponent>,
): LayerFinding {
  const locations = collectSourceLocations(flow);

  return {
    key: dataFlowIdentity(flow, componentsById),
    labels: [flow.type],
    sourceFilePaths: [...new Set(locations.map((location) => location.filePath))],
    sourceLines: locations.map((location) => ({
      file_path: location.filePath,
      start_line: location.startLine,
      end_line: location.endLine,
    })),
  };
}

export async function scanFixtureDataFlows(fixture: string): Promise<FixtureScanResult> {
  const root = path.join(FIXTURES_ROOT, fixture);
  const config = createDefaultScanConfiguration({ enableAiInference: false });
  const { scanResult, files } = await scan(root, config);

  const componentsById = new Map(
    scanResult.components.map((component) => [component.id, component]),
  );

  return {
    fixture,
    findings: scanResult.dataFlows.map((flow) => toLayerFinding(flow, componentsById)),
    scannedFiles: files.map((file) => file.path),
  };
}
