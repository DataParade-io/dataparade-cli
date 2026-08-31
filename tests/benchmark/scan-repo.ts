import {
  createDefaultScanConfiguration,
  scan,
} from "../../src/core/pipeline/orchestrator";
import { ingestFileSystem } from "../../src/ingest/file-system";
import {
  matchPiiSignalsInFiles,
  piiSignalIdentity,
  type PiiSignalHit,
} from "../../src/pii-signals/match-pii-signals";
import type { DetectedComponent } from "../../src/core/types/component";
import type { DetectedDataFlow } from "../../src/core/types/data-flow";
import type { SourceLocation } from "../../src/core/types/file";
import type { BenchmarkLayer } from "./schema";
import type { EvalLayer, FixtureScanResult, LayerFinding } from "../eval/types";
import { componentIdentity } from "../eval/layers/components/adapter";
import { dataFlowIdentity } from "../eval/layers/data-flows/adapter";
import { normalizeEvalPath } from "../eval/identity";

/** Normalize a repository-relative path to posix form for evidence matching. */
export function normalizeRepoRelativePath(filePath: string): string {
  return normalizeEvalPath(filePath);
}

function collectFlowSourceLocations(flow: DetectedDataFlow): SourceLocation[] {
  if (flow.sourceLocations && flow.sourceLocations.length > 0) {
    return flow.sourceLocations;
  }
  if (flow.sourceLocation) {
    return [flow.sourceLocation];
  }
  return [];
}

function toComponentFinding(component: DetectedComponent): LayerFinding {
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
    layer: "components",
    sourceFilePaths: [...new Set(sourceLines.map((line) => line.file_path))],
    sourceLines,
  };
}

function toDataFlowFinding(
  flow: DetectedDataFlow,
  componentsById: Map<string, DetectedComponent>,
): LayerFinding {
  const locations = collectFlowSourceLocations(flow);
  const sourceLines = locations.map((location) => ({
    file_path: normalizeRepoRelativePath(location.filePath),
    start_line: location.startLine,
    end_line: location.endLine,
  }));

  return {
    key: dataFlowIdentity(flow, componentsById),
    labels: [flow.type],
    layer: "data-flows",
    sourceFilePaths: [...new Set(sourceLines.map((line) => line.file_path))],
    sourceLines,
  };
}

function piiHitToSignalFinding(hit: PiiSignalHit): LayerFinding {
  const filePath = normalizeRepoRelativePath(hit.evidence.filePath);
  return {
    key: piiSignalIdentity(hit.id),
    labels: [...hit.labels],
    layer: "pii-signals",
    sourceFilePaths: [filePath],
    sourceLines: [
      {
        file_path: filePath,
        start_line: hit.evidence.startLine,
        end_line: hit.evidence.endLine,
      },
    ],
  };
}

function piiHitToDataItemFinding(hit: PiiSignalHit): LayerFinding {
  const filePath = normalizeRepoRelativePath(hit.evidence.filePath);
  return {
    key: `data_item:${hit.id}`,
    labels: [...hit.labels],
    layer: "data-items",
    sourceFilePaths: [filePath],
    sourceLines: [
      {
        file_path: filePath,
        start_line: hit.evidence.startLine,
        end_line: hit.evidence.endLine,
      },
    ],
  };
}

const BENCHMARK_TO_EVAL_LAYER: Record<BenchmarkLayer, EvalLayer> = {
  components: "components",
  data_flows: "data-flows",
  pii_signals: "pii-signals",
  data_items: "data-items",
};

/**
 * Scan a materialized benchmark repository root and return component findings
 * with repository-relative paths suitable for eval scoring.
 */
export async function scanRepoComponents(
  repoKey: string,
  repoRoot: string,
): Promise<FixtureScanResult> {
  const result = await scanRepoByManifestLayers(repoKey, repoRoot, ["components"]);
  return result;
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
  return scanRepoByManifestLayers(repoKey, repoRoot, ["data_items"]);
}

function unionSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/**
 * Scan a materialized benchmark repository for the requested layers.
 *
 * Orchestrator `scan()` runs at most once (components + data_flows).
 * PII matching runs at most once (pii_signals + data_items).
 * Findings are tagged with `layer` so the scorer never mixes bags.
 */
export async function scanRepoByManifestLayers(
  repoKey: string,
  repoRoot: string,
  layers: BenchmarkLayer[],
): Promise<FixtureScanResult> {
  const wanted = new Set(layers);
  const findings: LayerFinding[] = [];
  const scannedFiles: string[] = [];

  const needsOrchestrator = wanted.has("components") || wanted.has("data_flows");
  const needsPii = wanted.has("pii_signals") || wanted.has("data_items");

  if (needsOrchestrator) {
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult, files } = await scan(repoRoot, config);
    scannedFiles.push(...files.map((file) => normalizeRepoRelativePath(file.path)));

    if (wanted.has("components")) {
      findings.push(...scanResult.components.map(toComponentFinding));
    }

    if (wanted.has("data_flows")) {
      const componentsById = new Map(
        scanResult.components.map((component) => [component.id, component]),
      );
      findings.push(
        ...scanResult.dataFlows.map((flow) => toDataFlowFinding(flow, componentsById)),
      );
    }
  }

  if (needsPii) {
    const files = await ingestFileSystem(repoRoot);
    scannedFiles.push(...files.map((file) => normalizeRepoRelativePath(file.path)));

    const hits = matchPiiSignalsInFiles(
      files.map((file) => ({
        filePath: file.path,
        content: file.content,
      })),
    );

    if (wanted.has("pii_signals")) {
      findings.push(...hits.map(piiHitToSignalFinding));
    }
    if (wanted.has("data_items")) {
      findings.push(...hits.map(piiHitToDataItemFinding));
    }
  }

  return {
    fixture: repoKey,
    findings,
    scannedFiles: unionSorted(scannedFiles),
  };
}

export function evalLayerForBenchmarkLayer(layer: BenchmarkLayer): EvalLayer {
  return BENCHMARK_TO_EVAL_LAYER[layer];
}
