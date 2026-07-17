import type { ScanConfiguration, ScanProgress } from "../types";
import { DEFAULT_EXCLUDED_FILE_GLOBS } from "../../patterns/scan-exclusions";
import { traceDataparadeScan } from "../../tracing/langsmith-tracing";
import { runScanPipeline } from "./scan-pipeline";
import type { OrchestratorScanResult } from "./orchestrator-result";

export type { OrchestratorScanResult } from "./orchestrator-result";

/**
 * Construct a complete `ScanConfiguration` from a set of overrides.
 *
 * This is the single place where default scan behaviour is defined. Callers
 * (CLI, tests, future SDKs) should always go through this helper rather than
 * hand-rolling configuration objects so that new fields pick up sensible
 * defaults automatically.
 *
 * By default, co-located tests, Playwright config, and Storybook artifacts are not
 * scanned (`DEFAULT_EXCLUDED_FILE_GLOBS` and directory skips in `patterns/scan-exclusions.ts`).
 */
export function createDefaultScanConfiguration(
  overrides: Partial<ScanConfiguration> = {},
): ScanConfiguration {
  const { excludePaths: userExcludePaths, ...restOverrides } = overrides;

  const base: ScanConfiguration = {
    projectName: undefined,
    excludePaths: [],
    enableAPIDetection: true,
    enableDatabaseDetection: true,
    enableDataFlowDetection: true,
    languages: undefined,
    minimumConfidence: 0.5,
    deepAnalysis: false,
    enableAiInference: true,
    aiProvider: "mock",
    aiModel: "heuristic",
    aiEndpoint: undefined,
    aiApiKey: undefined,
    aiTemperature: 0.1,
    aiMaxTokens: 1024,
    aiMaxModelCalls: 12,
    aiBudgetTokens: 12000,
    aiProviderConcurrency: 4,
    aiMaxCandidatesPerAgent: 25,
    aiInferenceScope: "default",
    aiVerbose: false,
    aiToolLoopMaxRounds: 3,
    aiToolLoopMaxFiles: 8,
    aiToolLoopMaxSearches: 6,
    aiThirdPartyDataFlowEnabled: false,
    /** Infer Terraform stack section depth from `.tf` layout when depth is unset. */
    autoInferTerraformStackSectionPathDepth: true,
    /** Default workspace package depth (`packages/*`). Override via flag or config. */
    monorepoPackageSectionPathDepth: 2,
    autoInferMonorepoPackageSectionPathDepth: true,
  };

  return {
    ...base,
    ...restOverrides,
    excludePaths: [
      ...DEFAULT_EXCLUDED_FILE_GLOBS,
      ...(userExcludePaths ?? []),
    ],
  };
}

/**
 * Run the full structural scan pipeline for a given project root.
 *
 * This is the primary entrypoint for code that wants to scan a project:
 * the CLI, tests, and any future programmatic consumers should call `scan`
 * rather than reaching into individual ingest/analyzer/classifier modules.
 *
 * When LangSmith tracing is enabled (see `tracing/langsmith-tracing.ts`), the
 * full run is recorded as a root trace; AI inference is a nested trace.
 */
export async function scan(
  rootPath: string,
  config: ScanConfiguration,
  onProgress?: (progress: ScanProgress) => void,
): Promise<OrchestratorScanResult> {
  return traceDataparadeScan({
    rootPath: rootPath.toString(),
    projectName: config.projectName,
    enableAiInference: config.enableAiInference,
    run: () => runScanPipeline(rootPath, config, onProgress),
  });
}
