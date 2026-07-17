import type { AiProviderId } from "../../types";
import { AI_PROVIDER_SYSTEM_PROMPT } from "../../prompts/provider-enrichment-prompts";
import {
  aiDebugEnabled,
  parseAgentFromPrompt,
  strictParseAndNormalizeProposals,
} from "../provider-contract";
import { parseProviderJsonContent } from "../provider-json-parse";
import { readJsonOrWarn } from "../provider-runtime";
import { estimateTokenCostUsd } from "../provider-pricing";
import { clampStructuredJsonCompletionTokens } from "../provider-output-token-budget";
import { resolveGeminiGenerateContentEndpoint } from "../endpoint-resolution";
import { fetchWithTimeout } from "../fetch-with-timeout";
import { getProviderPreset } from "../presets";
import { resolveInferApiKey, type ResolvedProviderConfig } from "../resolve-provider";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "../types";

/** Google Gemini generateContent API. Used by the `gemini` preset. */
export class GenerateContentFamilyProvider implements AiProvider {
  readonly id: AiProviderId;

  constructor(private readonly resolved: ResolvedProviderConfig) {
    this.id = resolved.presetId;
  }

  async infer(request: AiProviderRequest): Promise<AiProviderResult> {
    const model = request.model?.trim() || this.resolved.model;
    const presetDefault = getProviderPreset(this.resolved.presetId).defaultEndpoint;
    const endpointUrl = resolveGeminiGenerateContentEndpoint(
      request.endpoint ?? this.resolved.endpoint,
      model,
      presetDefault,
    );
    const apiKey = resolveInferApiKey(request, this.resolved);
    if (this.resolved.auth === "query-key" && !apiKey) {
      return { proposals: [] };
    }
    const url = apiKey
      ? `${endpointUrl}${endpointUrl.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`
      : endpointUrl;

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: request.systemPrompt ?? AI_PROVIDER_SYSTEM_PROMPT }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: request.prompt }],
          },
        ],
        generationConfig: {
          temperature: request.temperature ?? 0.1,
          maxOutputTokens: clampStructuredJsonCompletionTokens(request.maxTokens),
          responseMimeType: "application/json",
        },
      }),
    });
    const payloadRaw = await readJsonOrWarn(response, "Gemini generateContent");
    if (payloadRaw == null) return { proposals: [] };
    const payload = payloadRaw as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };
    const content = (payload.candidates ?? [])
      .flatMap((c) => c.content?.parts ?? [])
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
    if (!content) return { proposals: [] };

    const parsed = parseProviderJsonContent(content);
    if (!parsed.ok) {
      if (aiDebugEnabled()) {
        console.warn("[dataparade-ai] Failed to parse Gemini JSON:", parsed.error);
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
      { debugLabel: "Gemini generateContent", userPrompt: request.prompt },
    );
    const inputTokens = Math.max(0, payload.usageMetadata?.promptTokenCount ?? 0);
    const outputTokens = Math.max(0, payload.usageMetadata?.candidatesTokenCount ?? 0);
    const totalTokens = Math.max(
      inputTokens + outputTokens,
      payload.usageMetadata?.totalTokenCount ?? 0,
    );
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
    return { proposals, usage };
  }
}
