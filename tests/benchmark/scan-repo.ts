import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../src/core/pipeline/orchestrator";
import { ingestFileSystem } from "../../src/ingest/file-system";
import {
  matchPiiSignalsInFiles,
  type PiiSignalHit,
} from "../../src/pii-signals/match-pii-signals";
import type { DetectedComponent } from "../../src/core/types/component";
import type { BenchmarkLayer } from "./schema";
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

function piiHitToDataItemFinding(hit: PiiSignalHit): LayerFinding {
  return {
    key: `data_item:${hit.id}`,
    labels: [...hit.labels],
    sourceFilePaths: [normalizeRepoRelativePath(hit.evidence.filePath)],
    sourceLines: [
      {
        file_path: normalizeRepoRelativePath(hit.evidence.filePath),
        start_line: hit.evidence.startLine,
        end_line: hit.evidence.endLine,
      },
    ],
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

/**
 * Scan a materialized benchmark repository for data-item findings using the
 * PII signal matcher. Each PII signal hit is mapped to a `data_item:<rule_id>`
 * finding with the rule's labels.
 */
export async function scanRepoDataItems(
  repoKey: string,
  repoRoot: string,
): Promise<FixtureScanResult> {
  const files = await ingestFileSystem(repoRoot);

  const hits = matchPiiSignalsInFiles(
    files.map((file) => ({
      filePath: file.path,
      content: file.content,
    })),
  );

  return {
    fixture: repoKey,
    findings: hits.map(piiHitToDataItemFinding),
    scannedFiles: files.map((file) => normalizeRepoRelativePath(file.path)),
  };
}

const LAYER_SCANNERS: Record<
  BenchmarkLayer,
  (repoKey: string, repoRoot: string) => Promise<FixtureScanResult>
> = {
  components: scanRepoComponents,
  data_flows: scanRepoComponents,
  pii_signals: scanRepoComponents,
  data_items: scanRepoDataItems,
};

/**
 * Scan a materialized benchmark repository for all layers declared in its
 * manifest, merging findings from each layer scanner into a single result.
 */
export async function scanRepoByManifestLayers(
  repoKey: string,
  repoRoot: string,
  layers: BenchmarkLayer[],
): Promise<FixtureScanResult> {
  const seenFiles = new Set<string>();
  const allFindings: LayerFinding[] = [];

  for (const layer of layers) {
    const scanner = LAYER_SCANNERS[layer] ?? scanRepoComponents;
    const result = await scanner(repoKey, repoRoot);
    allFindings.push(...result.findings);
    for (const file of result.scannedFiles) {
      seenFiles.add(file);
    }
  }

  return {
    fixture: repoKey,
    findings: allFindings,
    scannedFiles: [...seenFiles].sort(),
  };
}
