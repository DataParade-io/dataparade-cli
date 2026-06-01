import type { AiProviderId } from "../../types";
import { AI_PROVIDER_SYSTEM_PROMPT } from "../../prompts/provider-enrichment-prompts";
import {
  aiDebugEnabled,
  parseAgentFromPrompt,
  strictParseAndNormalizeProposals,
} from "../provider-contract";
import { parseProviderJsonContent } from "../provider-json-parse";
import { readJsonOrWarn } from "../provider-runtime";
import { clampStructuredJsonCompletionTokens } from "../provider-output-token-budget";
import { fetchWithTimeout } from "../fetch-with-timeout";
import type { ResolvedProviderConfig } from "../resolve-provider";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "../types";

/** Ollama POST /api/generate. Used by the `local` preset. */
export class OllamaGenerateFamilyProvider implements AiProvider {
  readonly id: AiProviderId;

  constructor(private readonly resolved: ResolvedProviderConfig) {
    this.id = resolved.presetId;
  }

  async infer(request: AiProviderRequest): Promise<AiProviderResult> {
    const endpoint = request.endpoint?.trim() || this.resolved.endpoint;
    const model = request.model?.trim() || this.resolved.model;
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: `${AI_PROVIDER_SYSTEM_PROMPT}\n\nUser payload:\n${request.prompt}`,
        stream: false,
        options: {
          temperature: request.temperature ?? 0.1,
          num_predict: clampStructuredJsonCompletionTokens(request.maxTokens),
        },
      }),
    });
    const payloadRaw = await readJsonOrWarn(response, "Local/Ollama");
    if (payloadRaw == null) return { proposals: [] };
    const payload = payloadRaw as {
      response?: unknown;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const text = typeof payload.response === "string" ? payload.response.trim() : "";
    if (!text) return { proposals: [] };
    const parsed = parseProviderJsonContent(text);
    if (!parsed.ok) {
      if (aiDebugEnabled()) {
        console.warn("[dataparade-ai] Failed to parse Local/Ollama JSON:", parsed.error);
      }
      return { proposals: [] };
    }

    const proposals = strictParseAndNormalizeProposals(
      parsed.value,
      {
        provider: this.resolved.presetId,
        model,
        agent: parseAgentFromPrompt(request.prompt),
      },
      { debugLabel: "Local/Ollama generate", userPrompt: request.prompt },
    );
    const inputTokens = Math.max(0, payload.prompt_eval_count ?? 0);
    const outputTokens = Math.max(0, payload.eval_count ?? 0);
    const totalTokens = inputTokens + outputTokens;
    return {
      proposals,
      usage:
        totalTokens > 0
          ? {
              inputTokens,
              outputTokens,
              totalTokens,
              estimatedCostUsd: 0,
            }
          : undefined,
    };
  }
}
