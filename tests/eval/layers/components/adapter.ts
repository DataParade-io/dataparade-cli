import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../../src/core/pipeline/orchestrator";
import type { DetectedComponent } from "../../../../src/core/types/component";
import type { FixtureScanResult, LayerFinding } from "../../types";

const FIXTURES_ROOT = path.join(__dirname, "../../../fixtures");

/** Component identity aligned with tests/benchmark subject keys: `type:name` lowercase */
export function componentIdentity(component: DetectedComponent): string {
  return `${component.type}:${component.name.toLowerCase()}`;
}

function toLayerFinding(component: DetectedComponent): LayerFinding {
  const labels: string[] = [component.type];
  if (component.subType) {
    labels.push(component.subType);
  }

  return {
    key: componentIdentity(component),
    labels,
    sourceFilePaths: component.sourceLocations.map((location) => location.filePath),
    sourceLines: component.sourceLocations.map((location) => ({
      file_path: location.filePath,
      start_line: location.startLine,
      end_line: location.endLine,
    })),
  };
}

export async function scanFixtureComponents(fixture: string): Promise<FixtureScanResult> {
  const root = path.join(FIXTURES_ROOT, fixture);
  const config = createDefaultScanConfiguration({ enableAiInference: false });
  const { scanResult, files } = await scan(root, config);

  return {
    fixture,
    findings: scanResult.components.map(toLayerFinding),
    scannedFiles: files.map((file) => file.path),
  };
}
