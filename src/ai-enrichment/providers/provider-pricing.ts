import type { AiProviderId } from "../types";

type TokenPricing = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
};

// Best-effort public list; keep intentionally narrow and explicit.
const MODEL_PRICING_USD_PER_MILLION: Record<string, TokenPricing> = {
  "gpt-4o-mini": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
  "openai/gpt-4o-mini": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
  "claude-sonnet-4-5": { inputPerMillionUsd: 3.0, outputPerMillionUsd: 15.0 },
  "gemini-1.5-flash": { inputPerMillionUsd: 0.075, outputPerMillionUsd: 0.3 },
};

function resolvePricing(model: string): TokenPricing | undefined {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return undefined;
  if (MODEL_PRICING_USD_PER_MILLION[normalized]) {
    return MODEL_PRICING_USD_PER_MILLION[normalized];
  }
  // Match dated suffixes (for example: claude-sonnet-4-5-20250929).
  const entry = Object.entries(MODEL_PRICING_USD_PER_MILLION).find(([key]) =>
    normalized.startsWith(`${key}-`),
  );
  return entry?.[1];
}

export function estimateTokenCostUsd(input: {
  provider: AiProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number | undefined {
  // Local and mock providers are not billable from this CLI's perspective.
  if (input.provider === "local" || input.provider === "mock") return 0;
  const pricing = resolvePricing(input.model);
  if (!pricing) return undefined;
  const inCost = (Math.max(0, input.inputTokens) / 1_000_000) * pricing.inputPerMillionUsd;
  const outCost =
    (Math.max(0, input.outputTokens) / 1_000_000) * pricing.outputPerMillionUsd;
  return inCost + outCost;
}
