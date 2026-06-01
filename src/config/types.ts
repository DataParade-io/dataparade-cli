import type { ScanConfiguration } from "../core/types";
import type { FileLanguage } from "../core/types";
import type { AiInferenceScope, AiProviderId } from "../ai-enrichment/types";

// Shape of values loaded from dataparade.config.json
export interface CliConfigFile {
  projectName?: string;
  excludePaths?: string[];
  enableAPIDetection?: boolean;
  enableDatabaseDetection?: boolean;
  enableDataFlowDetection?: boolean;
  languages?: FileLanguage[];
  minimumConfidence?: number;
  deepAnalysis?: boolean;
  terraformJsonPath?: string;
  terraformPlanPath?: string;
  terraformStackSectionPathDepth?: number;
  autoInferTerraformStackSectionPathDepth?: boolean;
  monorepoPackageSectionPathDepth?: number;
  autoInferMonorepoPackageSectionPathDepth?: boolean;
  enableAiInference?: boolean;
  aiProvider?: AiProviderId;
  aiModel?: string;
  aiEndpoint?: string;
  aiTemperature?: number;
  aiMaxTokens?: number;
  aiMaxModelCalls?: number;
  aiBudgetTokens?: number;
  aiProviderConcurrency?: number;
  aiMaxCandidatesPerAgent?: number;
  aiInferenceScope?: AiInferenceScope;
  aiVerbose?: boolean;
  aiToolLoopMaxRounds?: number;
  aiToolLoopMaxFiles?: number;
  aiToolLoopMaxSearches?: number;
  aiThirdPartyDataFlowEnabled?: boolean;
  workspaceApiKey?: string;
}

// Shape of values loaded from environment variables
export interface CliConfigEnv {
  excludePaths?: string[];
  minimumConfidence?: number;
  aiModel?: string;
  aiApiKey?: string;
  aiProvider?: AiProviderId;
  aiEndpoint?: string;
  aiTemperature?: number;
  aiMaxTokens?: number;
  aiMaxModelCalls?: number;
  aiBudgetTokens?: number;
  aiProviderConcurrency?: number;
  aiMaxCandidatesPerAgent?: number;
  aiInferenceScope?: AiInferenceScope;
  enableAiInference?: boolean;
  aiVerbose?: boolean;
  aiToolLoopMaxRounds?: number;
  aiToolLoopMaxFiles?: number;
  aiToolLoopMaxSearches?: number;
  aiThirdPartyDataFlowEnabled?: boolean;
  workspaceApiKey?: string;
}

// Flags we care about from the scan command
export interface CliConfigFlags {
  exclude?: string[];
  minimumConfidence?: number;
  language?: string[];
  deepAnalysis?: boolean;
  projectName?: string;
  terraformJson?: string;
  terraformPlan?: string;
  terraformStackSectionPathDepth?: number;
  noTerraformStackSectionAuto?: boolean;
  monorepoPackageSectionPathDepth?: number;
  noMonorepoPackageSectionAuto?: boolean;
  aiInference?: boolean;
  aiProvider?: AiProviderId;
  aiModel?: string;
  aiEndpoint?: string;
  aiTemperature?: number;
  aiMaxTokens?: number;
  aiMaxModelCalls?: number;
  aiBudgetTokens?: number;
  aiProviderConcurrency?: number;
  aiMaxCandidatesPerAgent?: number;
  aiInferenceScope?: AiInferenceScope;
  aiVerbose?: boolean;
  workspaceApiKey?: string;
  byokProvider?: AiProviderId;
  byokModel?: string;
  aiToolLoopMaxRounds?: number;
  aiToolLoopMaxFiles?: number;
  aiToolLoopMaxSearches?: number;
  aiThirdPartyDataFlowEnabled?: boolean;
}

export interface ResolveConfigOptions {
  cwd: string;
  flags: CliConfigFlags;
}

export interface ResolvedScanConfiguration {
  /**
   * Partial override values that will be merged into the
   * orchestrator's createDefaultScanConfiguration().
   */
  overrides: Partial<ScanConfiguration>;
  /**
   * Non-fatal issues discovered while reading config file or env.
   * These can be surfaced to the user as warnings.
   */
  warnings: string[];
}

