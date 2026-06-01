import { AI_PROVIDER_IDS, type AiProviderId } from "../ai-enrichment/types";

const KNOWN_PROVIDERS = new Set<string>(AI_PROVIDER_IDS);

export function normalizeAiProviderId(
  value: string | undefined,
): { provider: AiProviderId | undefined; warning?: string } {
  const trimmed = value?.trim();
  if (!trimmed) {
    return { provider: undefined };
  }
  if (KNOWN_PROVIDERS.has(trimmed)) {
    return { provider: trimmed as AiProviderId };
  }
  return {
    provider: undefined,
    warning: `Unknown SCAN_BYOK_PROVIDER "${trimmed}"; expected one of: ${AI_PROVIDER_IDS.join(", ")}. Using default provider.`,
  };
}
