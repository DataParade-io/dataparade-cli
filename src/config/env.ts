import type { CliConfigEnv } from "./types";
import { parseAiInferenceScope } from "./inference-scope";
import { normalizeAiProviderId } from "./normalize-ai-provider";
import {
  resolveByokApiKey,
  resolveByokModel,
  resolveByokProvider,
  resolveHostedInferProxyUrl,
  resolveScanAiInference,
  resolveWorkspaceApiKey,
} from "./scan-env";

function parseNumber(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseStringArray(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

export function loadCliConfigEnv(env: NodeJS.ProcessEnv): CliConfigEnv {
  const excludePaths = parseStringArray(env.DATAPARADE_EXCLUDES);
  const minimumConfidence = parseNumber(env.DATAPARADE_MIN_CONFIDENCE);

  const aiModel = resolveByokModel(env);
  const aiApiKey = resolveByokApiKey(env);
  const aiProviderRaw = resolveByokProvider(env);
  const { provider: aiProvider } = normalizeAiProviderId(aiProviderRaw);
  const aiEndpoint = env.SCAN_AI_ENDPOINT?.trim();
  const aiTemperature = parseNumber(env.SCAN_AI_TEMPERATURE);
  const aiMaxTokens = parseNumber(env.SCAN_AI_MAX_TOKENS);
  const aiMaxModelCalls = parseNumber(env.SCAN_AI_MAX_CALLS);
  const aiBudgetTokens = parseNumber(env.SCAN_AI_BUDGET_TOKENS);
  const aiProviderConcurrency = parseNumber(env.SCAN_AI_PROVIDER_CONCURRENCY);
  const aiMaxCandidatesPerAgent = parseNumber(env.SCAN_AI_MAX_CANDIDATES_PER_AGENT);
  const enableAiInference = parseBoolean(resolveScanAiInference(env));
  const aiInferenceScope = parseAiInferenceScope(env.SCAN_AI_INFERENCE_SCOPE);
  const aiVerbose = parseBoolean(env.SCAN_AI_VERBOSE);
  const aiToolLoopMaxRounds = parseNumber(env.SCAN_AI_TOOL_LOOP_MAX_ROUNDS);
  const aiToolLoopMaxFiles = parseNumber(env.SCAN_AI_TOOL_LOOP_MAX_FILES);
  const aiToolLoopMaxSearches = parseNumber(env.SCAN_AI_TOOL_LOOP_MAX_SEARCHES);
  const aiThirdPartyDataFlowEnabled = parseBoolean(env.SCAN_AI_THIRD_PARTY_DATA_FLOW);
  const workspaceApiKey = resolveWorkspaceApiKey(env);
  const hostedInferProxyUrl = resolveHostedInferProxyUrl(env);

  return {
    excludePaths,
    minimumConfidence,
    aiModel: aiModel || undefined,
    aiApiKey: aiApiKey || undefined,
    aiProvider: aiProvider || undefined,
    aiEndpoint: aiEndpoint || undefined,
    aiTemperature,
    aiMaxTokens,
    aiMaxModelCalls,
    aiBudgetTokens,
    aiProviderConcurrency,
    aiMaxCandidatesPerAgent,
    aiInferenceScope,
    enableAiInference,
    aiVerbose,
    aiToolLoopMaxRounds,
    aiToolLoopMaxFiles,
    aiToolLoopMaxSearches,
    aiThirdPartyDataFlowEnabled,
    workspaceApiKey: workspaceApiKey || undefined,
    hostedInferProxyUrl: hostedInferProxyUrl || undefined,
  };
}
