import { MockAiProvider } from "./mock";
import { resolveProviderConfig, type ResolveProviderOverrides } from "./resolve-provider";
import { ChatCompletionsFamilyProvider } from "./families/chat-completions-family";
import { MessagesFamilyProvider } from "./families/messages-family";
import { GenerateContentFamilyProvider } from "./families/generate-content-family";
import { OllamaGenerateFamilyProvider } from "./families/ollama-generate-family";
import type { AiProvider } from "./types";
import type { AiProviderId } from "../types";

export interface CreateAiProviderOptions extends ResolveProviderOverrides {}

/**
 * Builds an {@link AiProvider} from a user-facing preset id (`openai`, `anthropic`, …).
 * HTTP shape is selected by API family (see {@link resolveProviderConfig}), not per-vendor classes.
 */
export function createAiProvider(
  presetId: AiProviderId | string | undefined,
  options: CreateAiProviderOptions = {},
): AiProvider {
  const resolved = resolveProviderConfig(presetId, options);

  switch (resolved.family) {
    case "chat-completions":
      return new ChatCompletionsFamilyProvider(resolved);
    case "messages":
      return new MessagesFamilyProvider(resolved);
    case "generate-content":
      return new GenerateContentFamilyProvider(resolved);
    case "ollama-generate":
      return new OllamaGenerateFamilyProvider(resolved);
    case "mock":
    default:
      return new MockAiProvider();
  }
}

export type { AiProvider, AiProviderRequest } from "./types";
export type { AiProviderId } from "../types";
export { resolveProviderConfig, resolveInferApiKey } from "./resolve-provider";
export {
  resolveChatCompletionsEndpoint,
  resolveGeminiGenerateContentEndpoint,
  shouldUseChatCompletionsJsonShim,
} from "./endpoint-resolution";
export { AI_PROVIDER_PRESETS, getProviderPreset } from "./presets";
export type { AiApiFamily, AiProviderPresetDefinition } from "./presets";
