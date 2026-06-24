import fs from "fs";

import type { DiagramGraphJsonSchema } from "../core/schema";
import {
  type DataflowMetadataSchema,
  type DataflowWrapperSchema,
  validateDataflowJson,
} from "../core/schema/dataflow-wrapper.schema";
import type { ScanResult } from "../core/types";

export interface BuildDataflowWrapperOptions {
  /**
   * Optional schema version to embed in the wrapper.
   *
   * Defaults to `"1.0"` which matches the current DataParade import contract.
   * Callers should only override this when coordinating with a newer
   * dataflow.json schema version.
   */
  schemaVersion?: string;
  /** Assessment / project name shown in the dashboard import preview. */
  projectName?: string;
}

/**
 * Assemble the top-level `dataflow.json` wrapper object from a scan result and graph.
 *
 * This function is intentionally free of I/O and validation side effects; it
 * just constructs a value that can then be validated and written by callers.
 */
export function buildDataflowWrapper(
  scanResult: ScanResult,
  graph: DiagramGraphJsonSchema,
  options: BuildDataflowWrapperOptions = {},
): DataflowWrapperSchema {
  const schemaVersion = options.schemaVersion ?? "1.0";
  const projectName = options.projectName?.trim();

  const metadata: DataflowMetadataSchema = {
    componentsCount: scanResult.components.length,
    dataFlowsCount: scanResult.dataFlows.length,
    filesScanned: scanResult.filesScanned,
    scanDurationMs: scanResult.scanDurationMs,
    ...(projectName ? { projectName } : {}),
  };

  if (scanResult.aiInferenceSummary) {
    (metadata as Record<string, unknown>).aiInference =
      scanResult.aiInferenceSummary;
  }

  if (scanResult.terraformScanSummary) {
    (metadata as Record<string, unknown>).terraform = scanResult.terraformScanSummary;
  }

  return {
    schemaVersion,
    graph,
    metadata,
  };
}

export interface WriteDataflowJsonOptions {
  /**
   * Validated structural scan result produced by the orchestrator.
   */
  scanResult: ScanResult;
  /**
   * Diagram graph built from the scan result via `buildDiagramGraphFromScanResult`.
   */
  graph: DiagramGraphJsonSchema;
  /**
   * Absolute or relative file path where the wrapper JSON should be written.
   */
  outputPath: string;
  /**
   * Optional schema version to pass through to `buildDataflowWrapper`.
   */
  schemaVersion?: string;
  /** Assessment / project name stored in wrapper metadata for upload and preview. */
  projectName?: string;
}

/**
 * Validate and write a `dataflow.json` wrapper to disk.
 *
 * Responsibilities:
 * - Construct a wrapper object using `buildDataflowWrapper`.
 * - Validate the wrapper against `DataflowWrapperSchema` and throw a
 *   descriptive error if it is invalid.
 * - Synchronously write the pretty-printed JSON file to `outputPath`.
 *
 * CLI callers rely on this function throwing for fatal output errors so they
 * can emit a non-zero exit code.
 */
export function writeDataflowJson(options: WriteDataflowJsonOptions): void {
  const { scanResult, graph, outputPath, schemaVersion, projectName } = options;

  const wrapper = buildDataflowWrapper(scanResult, graph, {
    schemaVersion,
    projectName,
  });

  const validation = validateDataflowJson(wrapper);
  if (!validation.ok) {
    const messages = validation.errors.join("; ");
    throw new Error(`Invalid dataflow.json wrapper: ${messages}`);
  }

  const json = JSON.stringify(validation.value, null, 2);

  fs.writeFileSync(outputPath, json, "utf8");
}

