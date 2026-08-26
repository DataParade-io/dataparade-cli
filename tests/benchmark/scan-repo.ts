import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../src/core/pipeline/orchestrator";
import type { DetectedComponent } from "../../src/core/types/component";
import type { FixtureScanResult, LayerFinding } from "../eval/types";
import { componentIdentity } from "../eval/layers/components/adapter";

/** Normalize a repository-relative path to posix form for evidence matching. */
export function normalizeRepoRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

function toLayerFinding(component: DetectedComponent): LayerFinding {
  const labels: string[] = [component.type];
  if (component.subType) {
    labels.push(component.subType);
  }

  const sourceLines = component.sourceLocations.map((location) => ({
    file_path: normalizeRepoRelativePath(location.filePath),
    start_line: location.startLine,
    end_line: location.endLine,
  }));

  return {
    key: componentIdentity(component),
    labels,
    sourceFilePaths: [...new Set(sourceLines.map((line) => line.file_path))],
    sourceLines,
  };
}

/**
 * Scan a materialized benchmark repository root and return component findings
 * with repository-relative paths suitable for eval scoring.
 */
export async function scanRepoComponents(
  repoKey: string,
  repoRoot: string,
): Promise<FixtureScanResult> {
  const config = createDefaultScanConfiguration({ enableAiInference: false });
  const { scanResult, files } = await scan(repoRoot, config);

  return {
    fixture: repoKey,
    findings: scanResult.components.map(toLayerFinding),
    scannedFiles: files.map((file) => normalizeRepoRelativePath(file.path)),
  };
}
