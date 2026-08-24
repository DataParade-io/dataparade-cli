import type { ScanConfiguration } from "../core/types";
import type { FileLanguage } from "../core/types";

import { normalizeAiProviderId } from "./normalize-ai-provider";
import { loadCliConfigFile } from "./file";
import { loadCliConfigEnv } from "./env";
import type {
  CliConfigFlags,
  ResolveConfigOptions,
  ResolvedScanConfiguration,
} from "./types";

/**
 * Normalize user-supplied language identifiers from flags/config into the
 * internal `FileLanguage` union.
 *
 * Unknown values are silently dropped; if no valid languages remain the
 * function returns `undefined` to signal \"no language filter\".
 */
function normalizeLanguages(
  values: string[] | undefined,
): FileLanguage[] | undefined {
  if (!values || values.length === 0) return undefined;

  const normalized = values.map((v) => v.toLowerCase().trim());
  // Filter to known languages; fall back to leaving them out if none match.
  const allowed: FileLanguage[] = [
    "typescript",
    "javascript",
    "json",
    "yaml",
    "env",
    "python",
    "cpp",
    "csharp",
    "go",
    "java",
    "kotlin",
    "terraform",
    "dockerfile",
  ];

  const result = normalized.filter((v): v is FileLanguage =>
    (allowed as string[]).includes(v),
  );

  return result.length > 0 ? result : undefined;
}

/**
 * Convert raw CLI flags into a partial `ScanConfiguration` override object.
 *
 * This helper is the single place where flag semantics are enforced
 * (clamping numeric values, validating language names, etc.) so that
 * `resolveScanConfiguration` can compose flags with config file and env
 * overrides in a predictable way.
 */
function normalizeFlags(flags: CliConfigFlags): Partial<ScanConfiguration> {
  const overrides: Partial<ScanConfiguration> = {};

  if (flags.projectName) {
    overrides.projectName = flags.projectName;
  }

  if (flags.exclude && flags.exclude.length > 0) {
    overrides.excludePaths = flags.exclude;
  }

  if (typeof flags.minimumConfidence === "number") {
    const clamped = Math.max(0, Math.min(flags.minimumConfidence, 1));
    overrides.minimumConfidence = clamped;
  }

  if (flags.language && flags.language.length > 0) {
    const languages = normalizeLanguages(flags.language);
    if (languages && languages.length > 0) {
      overrides.languages = languages;
    }
  }

  if (typeof flags.deepAnalysis === "boolean") {
    overrides.deepAnalysis = flags.deepAnalysis;
  }

  if (flags.terraformJson?.trim()) {
    overrides.terraformJsonPath = flags.terraformJson.trim();
  }
  if (flags.terraformPlan?.trim()) {
    overrides.terraformPlanPath = flags.terraformPlan.trim();
  }
  if (
    typeof flags.terraformStackSectionPathDepth === "number" &&
    Number.isInteger(flags.terraformStackSectionPathDepth) &&
    flags.terraformStackSectionPathDepth > 0
  ) {
    overrides.terraformStackSectionPathDepth = flags.terraformStackSectionPathDepth;
  }
  if (flags.noTerraformStackSectionAuto === true) {
    overrides.autoInferTerraformStackSectionPathDepth = false;
  }
  if (
    typeof flags.monorepoPackageSectionPathDepth === "number" &&
    Number.isInteger(flags.monorepoPackageSectionPathDepth) &&
    flags.monorepoPackageSectionPathDepth > 0
  ) {
    overrides.monorepoPackageSectionPathDepth = flags.monorepoPackageSectionPathDepth;
  }
  if (flags.noMonorepoPackageSectionAuto === true) {
    overrides.autoInferMonorepoPackageSectionPathDepth = false;
  }

  if (typeof flags.aiInference === "boolean") {
    overrides.enableAiInference = flags.aiInference;
  }
  if (flags.aiProvider) {
    overrides.aiProvider = flags.aiProvider;
  }
  if (flags.aiModel) {
    overrides.aiModel = flags.aiModel;
  }
  if (flags.aiEndpoint) {
    overrides.aiEndpoint = flags.aiEndpoint;
  }
  if (typeof flags.aiTemperature === "number") {
    overrides.aiTemperature = Math.max(0, Math.min(flags.aiTemperature, 2));
  }
  if (typeof flags.aiMaxTokens === "number" && Number.isFinite(flags.aiMaxTokens)) {
    overrides.aiMaxTokens = Math.max(1, Math.floor(flags.aiMaxTokens));
  }
  if (
    typeof flags.aiMaxModelCalls === "number" &&
    Number.isFinite(flags.aiMaxModelCalls)
  ) {
    overrides.aiMaxModelCalls = Math.max(1, Math.floor(flags.aiMaxModelCalls));
  }
  if (
    typeof flags.aiBudgetTokens === "number" &&
    Number.isFinite(flags.aiBudgetTokens)
  ) {
    overrides.aiBudgetTokens = Math.max(1, Math.floor(flags.aiBudgetTokens));
  }
  if (
    typeof flags.aiProviderConcurrency === "number" &&
    Number.isFinite(flags.aiProviderConcurrency)
  ) {
    overrides.aiProviderConcurrency = Math.max(
      1,
      Math.floor(flags.aiProviderConcurrency),
    );
  }
  if (
    typeof flags.aiMaxCandidatesPerAgent === "number" &&
    Number.isFinite(flags.aiMaxCandidatesPerAgent)
  ) {
    overrides.aiMaxCandidatesPerAgent = Math.max(
      0,
      Math.floor(flags.aiMaxCandidatesPerAgent),
    );
  }
  if (flags.aiInferenceScope) {
    overrides.aiInferenceScope = flags.aiInferenceScope;
  }
  if (typeof flags.aiVerbose === "boolean") {
    overrides.aiVerbose = flags.aiVerbose;
  }
  if (typeof flags.aiToolLoopMaxRounds === "number") {
    overrides.aiToolLoopMaxRounds = Math.max(1, Math.floor(flags.aiToolLoopMaxRounds));
  }
  if (typeof flags.aiToolLoopMaxFiles === "number") {
    overrides.aiToolLoopMaxFiles = Math.max(1, Math.floor(flags.aiToolLoopMaxFiles));
  }
  if (typeof flags.aiToolLoopMaxSearches === "number") {
    overrides.aiToolLoopMaxSearches = Math.max(1, Math.floor(flags.aiToolLoopMaxSearches));
  }
  if (typeof flags.aiThirdPartyDataFlowEnabled === "boolean") {
    overrides.aiThirdPartyDataFlowEnabled = flags.aiThirdPartyDataFlowEnabled;
  }

  return overrides;
}

/**
 * Resolve the effective scan configuration overrides for a given working dir.
 *
 * Precedence (lowest to highest):
 * 1) `dataparade.config.json` in `cwd`
 * 2) Environment variables (`DATAPARADE_*`)
 * 3) CLI flags
 *
 * The resulting `overrides` object is intended to be passed to
 * `createDefaultScanConfiguration` to obtain a full `ScanConfiguration`.
 * Any validation or clamping of individual fields happens in this function
 * or its helpers.
 */
export function resolveScanConfiguration(
  options: ResolveConfigOptions,
): ResolvedScanConfiguration {
  const { cwd, flags } = options;

  const warnings: string[] = [];
  const overrides: Partial<ScanConfiguration> = {};

  // 1) Config file (lowest precedence)
  try {
    const fileResult = loadCliConfigFile(cwd);
    if (fileResult) {
      const { config } = fileResult;
      if (config.projectName) overrides.projectName = config.projectName;
      if (config.excludePaths) overrides.excludePaths = config.excludePaths;
      if (typeof config.enableAPIDetection === "boolean") {
        overrides.enableAPIDetection = config.enableAPIDetection;
      }
      if (typeof config.enableDatabaseDetection === "boolean") {
        overrides.enableDatabaseDetection = config.enableDatabaseDetection;
      }
      if (typeof config.enableDataFlowDetection === "boolean") {
        overrides.enableDataFlowDetection = config.enableDataFlowDetection;
      }
      if (config.languages) {
        overrides.languages = config.languages;
      }
      if (typeof config.minimumConfidence === "number") {
        const clamped = Math.max(0, Math.min(config.minimumConfidence, 1));
        overrides.minimumConfidence = clamped;
      }
      if (typeof config.deepAnalysis === "boolean") {
        overrides.deepAnalysis = config.deepAnalysis;
      }
      if (config.terraformJsonPath?.trim()) {
        overrides.terraformJsonPath = config.terraformJsonPath.trim();
      }
      if (config.terraformPlanPath?.trim()) {
        overrides.terraformPlanPath = config.terraformPlanPath.trim();
      }
      if (
        typeof config.terraformStackSectionPathDepth === "number" &&
        Number.isInteger(config.terraformStackSectionPathDepth) &&
        config.terraformStackSectionPathDepth > 0
      ) {
        overrides.terraformStackSectionPathDepth =
          config.terraformStackSectionPathDepth;
      }
      if (typeof config.autoInferTerraformStackSectionPathDepth === "boolean") {
        overrides.autoInferTerraformStackSectionPathDepth =
          config.autoInferTerraformStackSectionPathDepth;
      }
      if (
        typeof config.monorepoPackageSectionPathDepth === "number" &&
        Number.isInteger(config.monorepoPackageSectionPathDepth) &&
        config.monorepoPackageSectionPathDepth > 0
      ) {
        overrides.monorepoPackageSectionPathDepth =
          config.monorepoPackageSectionPathDepth;
      }
      if (typeof config.autoInferMonorepoPackageSectionPathDepth === "boolean") {
        overrides.autoInferMonorepoPackageSectionPathDepth =
          config.autoInferMonorepoPackageSectionPathDepth;
      }
      if (typeof config.enableAiInference === "boolean") {
        overrides.enableAiInference = config.enableAiInference;
      }
      if (config.aiProvider) overrides.aiProvider = config.aiProvider;
      if (config.aiModel) overrides.aiModel = config.aiModel;
      if (config.aiEndpoint) overrides.aiEndpoint = config.aiEndpoint;
      if (typeof config.aiTemperature === "number") {
        overrides.aiTemperature = Math.max(0, Math.min(config.aiTemperature, 2));
      }
      if (typeof config.aiMaxTokens === "number") {
        overrides.aiMaxTokens = Math.max(1, Math.floor(config.aiMaxTokens));
      }
      if (typeof config.aiMaxModelCalls === "number") {
        overrides.aiMaxModelCalls = Math.max(1, Math.floor(config.aiMaxModelCalls));
      }
      if (typeof config.aiBudgetTokens === "number") {
        overrides.aiBudgetTokens = Math.max(1, Math.floor(config.aiBudgetTokens));
      }
      if (typeof config.aiProviderConcurrency === "number") {
        overrides.aiProviderConcurrency = Math.max(
          1,
          Math.floor(config.aiProviderConcurrency),
        );
      }
      if (typeof config.aiMaxCandidatesPerAgent === "number") {
        overrides.aiMaxCandidatesPerAgent = Math.max(
          0,
          Math.floor(config.aiMaxCandidatesPerAgent),
        );
      }
      if (config.aiInferenceScope) {
        overrides.aiInferenceScope = config.aiInferenceScope;
      }
      if (typeof config.aiVerbose === "boolean") {
        overrides.aiVerbose = config.aiVerbose;
      }
      if (typeof config.aiToolLoopMaxRounds === "number") {
        overrides.aiToolLoopMaxRounds = Math.max(1, Math.floor(config.aiToolLoopMaxRounds));
      }
      if (typeof config.aiToolLoopMaxFiles === "number") {
        overrides.aiToolLoopMaxFiles = Math.max(1, Math.floor(config.aiToolLoopMaxFiles));
      }
      if (typeof config.aiToolLoopMaxSearches === "number") {
        overrides.aiToolLoopMaxSearches = Math.max(1, Math.floor(config.aiToolLoopMaxSearches));
      }
      if (typeof config.aiThirdPartyDataFlowEnabled === "boolean") {
        overrides.aiThirdPartyDataFlowEnabled = config.aiThirdPartyDataFlowEnabled;
      }
      warnings.push(...fileResult.warnings);
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error loading config file.";
    throw new Error(message);
  }

  // 2) Environment variables (override file for secrets / defaults)
  const envConfig = loadCliConfigEnv(process.env);
  if (envConfig.excludePaths && envConfig.excludePaths.length > 0) {
    overrides.excludePaths = envConfig.excludePaths;
  }
  if (typeof envConfig.minimumConfidence === "number") {
    const clamped = Math.max(0, Math.min(envConfig.minimumConfidence, 1));
    overrides.minimumConfidence = clamped;
  }
  if (typeof envConfig.enableAiInference === "boolean") {
    overrides.enableAiInference = envConfig.enableAiInference;
  }
  const byokProviderRaw = process.env.SCAN_BYOK_PROVIDER?.trim();
  if (byokProviderRaw) {
    const { provider, warning } = normalizeAiProviderId(byokProviderRaw);
    if (warning) warnings.push(warning);
    if (provider) overrides.aiProvider = provider;
  } else if (envConfig.aiProvider) {
    overrides.aiProvider = envConfig.aiProvider;
  }
  if (envConfig.workspaceApiKey) {
    overrides.workspaceApiKey = envConfig.workspaceApiKey;
  }
  if (envConfig.hostedInferProxyUrl) {
    overrides.hostedInferProxyUrl = envConfig.hostedInferProxyUrl;
  }
  if (envConfig.aiModel) {
    overrides.aiModel = envConfig.aiModel;
  }
  if (envConfig.aiApiKey) {
    overrides.aiApiKey = envConfig.aiApiKey;
  }
  if (envConfig.aiEndpoint) {
    overrides.aiEndpoint = envConfig.aiEndpoint;
  }
  if (typeof envConfig.aiTemperature === "number") {
    overrides.aiTemperature = Math.max(0, Math.min(envConfig.aiTemperature, 2));
  }
  if (typeof envConfig.aiMaxTokens === "number") {
    overrides.aiMaxTokens = Math.max(1, Math.floor(envConfig.aiMaxTokens));
  }
  if (typeof envConfig.aiMaxModelCalls === "number") {
    overrides.aiMaxModelCalls = Math.max(1, Math.floor(envConfig.aiMaxModelCalls));
  }
  if (typeof envConfig.aiBudgetTokens === "number") {
    overrides.aiBudgetTokens = Math.max(1, Math.floor(envConfig.aiBudgetTokens));
  }
  if (typeof envConfig.aiProviderConcurrency === "number") {
    overrides.aiProviderConcurrency = Math.max(
      1,
      Math.floor(envConfig.aiProviderConcurrency),
    );
  }
  if (typeof envConfig.aiMaxCandidatesPerAgent === "number") {
    overrides.aiMaxCandidatesPerAgent = Math.max(
      0,
      Math.floor(envConfig.aiMaxCandidatesPerAgent),
    );
  }
  if (envConfig.aiInferenceScope) {
    overrides.aiInferenceScope = envConfig.aiInferenceScope;
  }
  if (typeof envConfig.aiVerbose === "boolean") {
    overrides.aiVerbose = envConfig.aiVerbose;
  }
  if (typeof envConfig.aiToolLoopMaxRounds === "number") {
    overrides.aiToolLoopMaxRounds = Math.max(1, Math.floor(envConfig.aiToolLoopMaxRounds));
  }
  if (typeof envConfig.aiToolLoopMaxFiles === "number") {
    overrides.aiToolLoopMaxFiles = Math.max(1, Math.floor(envConfig.aiToolLoopMaxFiles));
  }
  if (typeof envConfig.aiToolLoopMaxSearches === "number") {
    overrides.aiToolLoopMaxSearches = Math.max(1, Math.floor(envConfig.aiToolLoopMaxSearches));
  }
  if (typeof envConfig.aiThirdPartyDataFlowEnabled === "boolean") {
    overrides.aiThirdPartyDataFlowEnabled = envConfig.aiThirdPartyDataFlowEnabled;
  }

  // 3) Flags (highest precedence)
  const flagOverrides = normalizeFlags(flags);

  if (flags.byokProvider?.trim()) {
    const { provider, warning } = normalizeAiProviderId(flags.byokProvider);
    if (warning) warnings.push(warning);
    if (provider) flagOverrides.aiProvider = provider;
    else delete flagOverrides.aiProvider;
  } else if (flags.aiProvider?.trim()) {
    const { provider, warning } = normalizeAiProviderId(flags.aiProvider);
    if (warning) warnings.push(warning);
    if (provider) flagOverrides.aiProvider = provider;
    else delete flagOverrides.aiProvider;
  }
  if (flags.byokModel?.trim()) {
    flagOverrides.aiModel = flags.byokModel.trim();
  }
  if (flags.workspaceApiKey?.trim()) {
    flagOverrides.workspaceApiKey = flags.workspaceApiKey.trim();
  }

  return {
    overrides: { ...overrides, ...flagOverrides },
    warnings,
  };
}

