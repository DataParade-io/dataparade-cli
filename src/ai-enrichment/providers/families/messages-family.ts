import type { AiProviderId } from "../../types";
import { buildAnthropicEnrichmentSystemPrompt } from "../../prompts/provider-enrichment-prompts";
import {
  aiDebugEnabled,
  parseAgentFromPrompt,
  strictParseAndNormalizeProposals,
} from "../provider-contract";
import {
  joinAnthropicTextBlocks,
  parseJsonTextOrWarn,
  readJsonOrWarn,
} from "../provider-runtime";
import { estimateTokenCostUsd } from "../provider-pricing";
import { clampStructuredJsonCompletionTokens } from "../provider-output-token-budget";
import { fetchWithTimeout } from "../fetch-with-timeout";
import { resolveInferApiKey, type ResolvedProviderConfig } from "../resolve-provider";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "../types";

const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

/** Anthropic Messages API. Used by the `anthropic` preset. */
export class MessagesFamilyProvider implements AiProvider {
  readonly id: AiProviderId;

  constructor(private readonly resolved: ResolvedProviderConfig) {
    this.id = resolved.presetId;
  }

  async infer(request: AiProviderRequest): Promise<AiProviderResult> {
    const apiKey = resolveInferApiKey(request, this.resolved);
    if (!apiKey) return { proposals: [] };

    const model = request.model?.trim() || this.resolved.model;
    const maxTokens = clampStructuredJsonCompletionTokens(request.maxTokens);
    const endpoint = request.endpoint?.trim() || this.resolved.endpoint;

    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": DEFAULT_ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: request.temperature ?? 0.1,
        system: buildAnthropicEnrichmentSystemPrompt(),
        messages: [{ role: "user", content: request.prompt }],
      }),
    });
    const payloadRaw = await readJsonOrWarn(response, "Anthropic messages");
    if (payloadRaw == null) return { proposals: [] };
    const payload = payloadRaw as {
      content?: Array<{ type?: string; text?: string }>;
      stop_reason?: string | null;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const textContent = joinAnthropicTextBlocks(payload.content);
    const stopReason = payload.stop_reason;

    const inputTokens = Math.max(0, payload.usage?.input_tokens ?? 0);
    const outputTokens = Math.max(0, payload.usage?.output_tokens ?? 0);
    const totalTokens = inputTokens + outputTokens;
    const usage =
      totalTokens > 0
        ? {
            inputTokens,
            outputTokens,
            totalTokens,
            estimatedCostUsd: estimateTokenCostUsd({
              provider: this.resolved.presetId,
              model,
              inputTokens,
              outputTokens,
            }),
          }
        : undefined;

    if (stopReason === "max_tokens") {
      console.warn(
        "[dataparade-ai] Anthropic stop_reason=max_tokens (output may be truncated). Raise DATAPARADE_AI_MAX_TOKENS or reduce prompt size; incomplete JSON cannot be merged.",
      );
    }

    if (!textContent) {
      if (aiDebugEnabled()) {
        console.warn("[dataparade-ai] Anthropic response had no text content blocks.");
      }
      return { proposals: [], usage };
    }
    const parsedValue = parseJsonTextOrWarn(textContent, {
      providerLabel: "Anthropic",
      finishReason: stopReason,
    });
    if (parsedValue == null) return { proposals: [], usage };
    const agent = parseAgentFromPrompt(request.prompt);
    const out = strictParseAndNormalizeProposals(
      parsedValue,
      {
        provider: this.resolved.presetId,
        model,
        agent,
      },
      { debugLabel: "Anthropic", userPrompt: request.prompt },
    );

    return { proposals: out, usage };
  }
}
