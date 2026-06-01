import type { AiProposal, AiProviderId } from "../../types";
import { getOpenAiProposalsResponseJsonSchemaForApi } from "../../openai-proposals-response.schema";
import { AI_PROVIDER_SYSTEM_PROMPT } from "../../prompts/provider-enrichment-prompts";
import {
  aiDebugEnabled,
  parseAgentFromPrompt,
  strictParseAndNormalizeProposals,
} from "../provider-contract";
import { parseJsonTextOrWarn, readJsonOrWarn } from "../provider-runtime";
import { estimateTokenCostUsd } from "../provider-pricing";
import { clampStructuredJsonCompletionTokens } from "../provider-output-token-budget";
import {
  resolveChatCompletionsEndpoint,
  shouldUseChatCompletionsJsonShim,
} from "../endpoint-resolution";
import { fetchWithTimeout } from "../fetch-with-timeout";
import { getProviderPreset } from "../presets";
import { resolveInferApiKey, type ResolvedProviderConfig } from "../resolve-provider";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "../types";

function useOpenAiStructuredJsonSchema(): boolean {
  const v = process.env.DATAPARADE_AI_OPENAI_JSON_SCHEMA?.trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

function openAiJsonSchemaStrictFromEnv(): boolean {
  const v = process.env.DATAPARADE_AI_OPENAI_JSON_SCHEMA_STRICT?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function sumUsage(parts: Array<{ prompt?: number; completion?: number; total?: number }>): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const inputTokens = parts.reduce((n, p) => n + Math.max(0, p.prompt ?? 0), 0);
  const outputTokens = parts.reduce((n, p) => n + Math.max(0, p.completion ?? 0), 0);
  const reportedTotal = parts.reduce((n, p) => n + Math.max(0, p.total ?? 0), 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: Math.max(inputTokens + outputTokens, reportedTotal),
  };
}

function parseProposalArray(input: unknown): AiProposal[] {
  if (!Array.isArray(input)) return [];
  return input as AiProposal[];
}

async function inferViaHttpJsonShim(
  presetId: AiProviderId,
  endpoint: string,
  request: AiProviderRequest,
  apiKey: string,
): Promise<AiProviderResult> {
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: request.model,
      prompt: request.prompt,
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 1024,
    }),
  });

  const payloadRaw = await readJsonOrWarn(response, "Chat completions shim");
  if (payloadRaw == null) return { proposals: [] };
  const payload = payloadRaw as {
    proposals?: unknown;
    data?: unknown;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      estimatedCostUsd?: number;
    };
  };
  return {
    proposals: parseProposalArray(payload.proposals ?? payload.data),
    usage:
      payload.usage &&
      typeof payload.usage.inputTokens === "number" &&
      typeof payload.usage.outputTokens === "number"
        ? {
            inputTokens: Math.max(0, payload.usage.inputTokens),
            outputTokens: Math.max(0, payload.usage.outputTokens),
            totalTokens: Math.max(
              Math.max(0, payload.usage.inputTokens) +
                Math.max(0, payload.usage.outputTokens),
              typeof payload.usage.totalTokens === "number"
                ? Math.max(0, payload.usage.totalTokens)
                : 0,
            ),
            estimatedCostUsd:
              typeof payload.usage.estimatedCostUsd === "number"
                ? Math.max(0, payload.usage.estimatedCostUsd)
                : undefined,
          }
        : undefined,
  };
}

/**
 * OpenAI-style Chat Completions API. Used by the `openai` preset; also supports a
 * legacy `{ model, prompt, max_tokens }` shim when the endpoint is not chat-completions-shaped.
 */
export class ChatCompletionsFamilyProvider implements AiProvider {
  readonly id: AiProviderId;

  constructor(private readonly resolved: ResolvedProviderConfig) {
    this.id = resolved.presetId;
  }

  async infer(request: AiProviderRequest): Promise<AiProviderResult> {
    const apiKey = resolveInferApiKey(request, this.resolved);
    if (!apiKey) return { proposals: [] };

    const presetDefault = getProviderPreset(this.resolved.presetId).defaultEndpoint;
    const url = resolveChatCompletionsEndpoint(
      request.endpoint ?? this.resolved.endpoint,
      presetDefault,
    );
    if (shouldUseChatCompletionsJsonShim(url)) {
      return inferViaHttpJsonShim(this.resolved.presetId, url, request, apiKey);
    }

    const agent = parseAgentFromPrompt(request.prompt);
    const model = request.model?.trim() || this.resolved.model;
    const maxTokens = clampStructuredJsonCompletionTokens(request.maxTokens);

    const responseFormat = useOpenAiStructuredJsonSchema()
      ? {
          type: "json_schema" as const,
          json_schema: getOpenAiProposalsResponseJsonSchemaForApi({
            strict: openAiJsonSchemaStrictFromEnv(),
          }),
        }
      : { type: "json_object" as const };
    const body = {
      model,
      messages: [
        { role: "system" as const, content: AI_PROVIDER_SYSTEM_PROMPT },
        { role: "user" as const, content: request.prompt },
      ],
      temperature: request.temperature ?? 0.1,
      max_tokens: maxTokens,
      response_format: responseFormat,
    };
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const payloadRaw = await readJsonOrWarn(response, "OpenAI chat/completions");
    if (payloadRaw == null) return { proposals: [] };
    const payload = payloadRaw as {
      choices?: Array<{
        finish_reason?: string;
        message?: {
          content?: string | null;
          refusal?: string | null;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const finishReason = payload.choices?.[0]?.finish_reason;
    if (finishReason === "length") {
      console.warn(
        "[dataparade-ai] OpenAI finish_reason=length (output may be truncated). Raise DATAPARADE_AI_MAX_TOKENS or reduce prompt size.",
      );
    }
    const message = payload.choices?.[0]?.message;
    if (message?.refusal != null && String(message.refusal).trim() !== "") {
      if (aiDebugEnabled()) {
        console.warn("[dataparade-ai] OpenAI refusal:", String(message.refusal).slice(0, 500));
      }
      return { proposals: [] };
    }
    const content = message?.content;
    if (!content || typeof content !== "string") {
      if (aiDebugEnabled()) {
        console.warn("[dataparade-ai] OpenAI response had no assistant message content.");
      }
      return { proposals: [] };
    }
    const parsed = parseJsonTextOrWarn(content, {
      providerLabel: "OpenAI",
      finishReason,
    });
    if (parsed == null) return { proposals: [] };
    const out = strictParseAndNormalizeProposals(
      parsed,
      {
        provider: this.resolved.presetId,
        model,
        agent,
      },
      { debugLabel: "OpenAI", userPrompt: request.prompt },
    );
    if (out.length === 0 && aiDebugEnabled()) {
      console.warn(
        "[dataparade-ai] OpenAI returned zero valid proposals after strict schema/normalization.",
      );
    }
    const usageTotals = sumUsage([
      {
        prompt: payload.usage?.prompt_tokens,
        completion: payload.usage?.completion_tokens,
        total: payload.usage?.total_tokens,
      },
    ]);
    const { inputTokens, outputTokens, totalTokens } = usageTotals;
    const usage =
      inputTokens > 0 || outputTokens > 0 || totalTokens > 0
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
    return { proposals: out, usage };
  }
}
