import path from "path";

import type {
  DetectedDataFlow,
  FileInfo,
  LanguageParserStats,
  RawFinding,
  ScanConfiguration,
  ScanPhase,
  ScanProgress,
  ScanResult,
  TerraformScanSummary,
} from "../types";
import type { DetectedComponent } from "../types/component";
import { validateScanResult } from "../schema/scan-result.schema";
import { dropCrossSectionServiceFlows } from "../../data-flow/drop-cross-section-flows";
import { runStructuralScanPhase } from "./structural-scan";
import { runClassifierPhase } from "./classifier-phase";
import { runDataFlowPhase } from "./dataflow-phase";
import {
  sortComponentsDeterministically,
  sortDataFlowsDeterministically,
} from "./sorting";
import type { OrchestratorScanResult } from "./orchestrator-result";
import { assignStableComponentIds } from "./stable-component-ids";
import { applyTerraformMinimalServiceScanResult } from "./terraform-minimal-services";
import type { ServiceSection } from "../sectioning/discover-service-sections";

export function emitScanProgress(
  onProgress: ((progress: ScanProgress) => void) | undefined,
  phase: ScanPhase,
  progress: number,
  totalFiles: number,
  message: string,
): void {
  if (!onProgress) return;
  const clamped = Math.max(0, Math.min(progress, 1));
  onProgress({
    phase,
    filesProcessed: totalFiles,
    totalFiles,
    progress: clamped,
    message,
  });
}

export interface DeterministicScanWork {
  components: DetectedComponent[];
  dataFlows: DetectedDataFlow[];
  files: FileInfo[];
  findings: RawFinding[];
  sections: ServiceSection[];
  filesScanned: number;
  totalLines: number;
  languageStats: LanguageParserStats[];
  terraformScanSummary?: TerraformScanSummary;
  warnings: string[];
  errors: string[];
  scanDurationMs: number;
}

export interface FinalizeDeterministicScanInput {
  work: DeterministicScanWork;
  aiInferenceSummary?: ScanResult["aiInferenceSummary"];
  structuralEnrichmentSummary?: ScanResult["structuralEnrichmentSummary"];
  aiInferenceProposalDetails?: ScanResult["aiInferenceProposalDetails"];
}

/**
 * Ingest → analyzers → classifier → data-flow, without AI enrichment or tracing.
 */
export async function runDeterministicScanPhases(
  rootPath: string,
  config: ScanConfiguration,
  onProgress?: (progress: ScanProgress) => void,
  workState?: {
    warnings: string[];
    errors: string[];
    startMs: number;
  },
): Promise<DeterministicScanWork> {
  const start = workState?.startMs ?? Date.now();
  const warnings = workState?.warnings ?? [];
  const errors = workState?.errors ?? [];

  const projectNameFromPath = path.basename(rootPath.toString());

  emitScanProgress(onProgress, "ingest", 0.05, 0, `Ingesting files from ${rootPath}...`);
  emitScanProgress(onProgress, "analyze", 0.25, 0, "Running structural scan...");

  const structural = await runStructuralScanPhase(
    rootPath,
    config,
    (warning) => warnings.push(warning),
  );
  const {
    files,
    findings,
    sections,
    filesScanned,
    totalLines,
    languageStats,
    terraformScanSummary,
  } = structural;

  emitScanProgress(
    onProgress,
    "classify",
    0.5,
    filesScanned,
    "Classifying detected components...",
  );

  const components = runClassifierPhase(findings, sections, {
    projectName: config.projectName ?? projectNameFromPath,
    minimumConfidence: config.minimumConfidence,
  });

  let dataFlows: DetectedDataFlow[] = [];
  if (config.enableDataFlowDetection) {
    emitScanProgress(
      onProgress,
      "data_flow",
      0.7,
      filesScanned,
      "Detecting data flows...",
    );

    try {
      dataFlows = runDataFlowPhase(files, components, findings, sections, {
        enableDataFlowDetection: config.enableDataFlowDetection,
        minimumConfidence: config.minimumConfidence,
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unknown error during data-flow detection.";
      errors.push(`data-flow: ${message}`);
      dataFlows = [];
    }
  }

  sortComponentsDeterministically(components);
  sortDataFlowsDeterministically(dataFlows);

  return {
    components,
    dataFlows,
    files,
    findings,
    sections,
    filesScanned,
    totalLines,
    languageStats,
    terraformScanSummary,
    warnings,
    errors,
    scanDurationMs: Date.now() - start,
  };
}

export function finalizeDeterministicScanResult(
  input: FinalizeDeterministicScanInput,
  onProgress?: (progress: ScanProgress) => void,
): OrchestratorScanResult {
  const { work } = input;
  let { components, dataFlows } = work;
  const { warnings, errors } = work;

  dataFlows = dropCrossSectionServiceFlows(components, dataFlows);

  emitScanProgress(
    onProgress,
    "output",
    0.95,
    work.filesScanned,
    "Assembling scan result...",
  );

  const reduced = applyTerraformMinimalServiceScanResult({
    components,
    dataFlows,
    filesScanned: work.filesScanned,
    filesSkipped: 0,
    totalLines: work.totalLines,
    scanDurationMs: work.scanDurationMs,
    warnings,
    errors,
    languageStats: work.languageStats.length > 0 ? work.languageStats : undefined,
    aiInferenceSummary: input.aiInferenceSummary,
    structuralEnrichmentSummary: input.structuralEnrichmentSummary,
    aiInferenceProposalDetails: input.aiInferenceProposalDetails,
    terraformScanSummary: work.terraformScanSummary,
  });
  const stableIds = assignStableComponentIds(reduced.components, reduced.dataFlows);

  const scanResult: ScanResult = {
    ...reduced,
    components: stableIds.components,
    dataFlows: stableIds.dataFlows,
    aiInferenceSummary: input.aiInferenceSummary,
    structuralEnrichmentSummary: input.structuralEnrichmentSummary,
  };

  const validation = validateScanResult(scanResult);
  if (!validation.ok) {
    errors.push(...validation.errors);
    scanResult.errors = errors;
  }

  emitScanProgress(onProgress, "output", 1, work.filesScanned, "Scan complete.");

  return {
    scanResult,
    files: work.files,
    findings: work.findings,
  };
}

/**
 * Deterministic structural scan: ingest through data-flow detection and graph assembly.
 * Does not import AI enrichment or LangSmith tracing.
 */
export async function runDeterministicScan(
  rootPath: string,
  config: ScanConfiguration,
  onProgress?: (progress: ScanProgress) => void,
): Promise<OrchestratorScanResult> {
  const work = await runDeterministicScanPhases(rootPath, config, onProgress);
  return finalizeDeterministicScanResult({ work }, onProgress);
}
