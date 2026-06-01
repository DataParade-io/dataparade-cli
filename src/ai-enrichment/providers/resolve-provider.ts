import type { AiProviderId } from "../types";
import { resolveChatCompletionsEndpoint } from "./endpoint-resolution";
import {
  AI_PROVIDER_PRESETS,
  type AiApiFamily,
  type AiProviderAuthStyle,
  type AiStructuredOutputMode,
} from "./presets";

export interface ResolvedProviderConfig {
  presetId: AiProviderId;
  family: AiApiFamily;
  endpoint: string;
  model: string;
  apiKey?: string;
  auth: AiProviderAuthStyle;
  structuredOutput?: AiStructuredOutputMode;
}

export interface ResolveProviderOverrides {
  endpoint?: string;
  model?: string;
  apiKey?: string;
}

/** Request wins; otherwise use the key from {@link resolveProviderConfig} / `createAiProvider`. */
export function resolveInferApiKey(
  request: { apiKey?: string },
  resolved: { apiKey?: string },
): string | undefined {
  const key = request.apiKey?.trim() || resolved.apiKey?.trim();
  return key || undefined;
}

const KNOWN_PRESETS = new Set<string>(Object.keys(AI_PROVIDER_PRESETS));

function normalizePresetId(presetId: string | undefined): AiProviderId {
  if (presetId && KNOWN_PRESETS.has(presetId)) {
    return presetId as AiProviderId;
  }
  return "mock";
}

/**
 * Maps a user-facing provider preset (e.g. `openai`) to an API family + resolved endpoint/model.
 * Unknown preset ids fall back to `mock` (same as createAiProvider default).
 */
export function resolveProviderConfig(
  presetId: string | undefined,
  overrides: ResolveProviderOverrides = {},
): ResolvedProviderConfig {
  const id = normalizePresetId(presetId);
  const preset = AI_PROVIDER_PRESETS[id];
  const rawEndpoint = overrides.endpoint?.trim() || preset.defaultEndpoint;
  const endpoint =
    preset.family === "chat-completions"
      ? resolveChatCompletionsEndpoint(rawEndpoint, preset.defaultEndpoint)
      : rawEndpoint;
  const model = overrides.model?.trim() || preset.defaultModel;
  const apiKey = overrides.apiKey?.trim() || undefined;

  return {
    presetId: id,
    family: preset.family,
    endpoint,
    model,
    apiKey,
    auth: preset.auth,
    structuredOutput: preset.structuredOutput,
  };
}
