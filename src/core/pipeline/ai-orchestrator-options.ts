import type { ScanConfiguration } from "../types";
import { resolveAiMode } from "../../config/validate-scan-ai";
import type { AgentOrchestratorOptions } from "../../ai-enrichment/agent-orchestrator";
import type { AiProviderId } from "../../ai-enrichment/types";
import { getDataparadeApiBaseUrl } from "../../platform-api/dataparade-api-base-url";

export function buildAgentOrchestratorOptions(
  config: ScanConfiguration,
  opts: { llmEnabled: boolean; skipStructuralHeuristics: boolean },
): AgentOrchestratorOptions {
  const aiMode = resolveAiMode(config);
  const platformProvider =
    (process.env.SCAN_WORKER_LLM_PROVIDER?.trim() as AiProviderId | undefined) ||
    "openai";
  const platformModel =
    process.env.SCAN_WORKER_LLM_MODEL?.trim() ||
    config.aiModel?.trim() ||
    "gpt-4o-mini";

  const base: AgentOrchestratorOptions = {
    provider:
      aiMode === "platform"
        ? platformProvider
        : (config.aiProvider ?? "openai"),
    model:
      aiMode === "platform"
        ? platformModel
        : (config.aiModel ?? "gpt-4o-mini"),
    endpoint: config.aiEndpoint,
    apiKey: config.aiApiKey,
    maxTokens: config.aiMaxTokens,
    temperature: config.aiTemperature,
    providerConcurrency: config.aiProviderConcurrency,
    toolLoopMaxRounds: config.aiToolLoopMaxRounds,
    toolLoopMaxFiles: config.aiToolLoopMaxFiles,
    toolLoopMaxSearches: config.aiToolLoopMaxSearches,
    llmEnabled: opts.llmEnabled,
    skipStructuralHeuristics: opts.skipStructuralHeuristics,
  };

  if (
    aiMode === "platform" &&
    config.workspaceApiKey?.trim() &&
    config.cliQuotaJobId?.trim()
  ) {
    base.platformProxy = {
      apiBaseUrl: config.platformApiBaseUrl ?? getDataparadeApiBaseUrl(),
      workspaceApiKey: config.workspaceApiKey.trim(),
      jobId: config.cliQuotaJobId.trim(),
    };
    base.apiKey = undefined;
    // HTTP API → Lambda integration timeout is 30s. Parallel infer calls each spin up
    // a VPC cold start (~8–10s) plus helper latency and can exceed that limit even when
    // the helper succeeds (client sees 503 "Service Unavailable").
    base.providerConcurrency = 1;
  }

  return base;
}
