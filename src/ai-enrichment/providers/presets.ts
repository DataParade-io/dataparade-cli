import type { AiProviderId } from "../types";

/** How the CLI speaks HTTP to a model API (not a vendor brand). */
export type AiApiFamily =
  | "chat-completions"
  | "messages"
  | "generate-content"
  | "ollama-generate"
  | "mock";

export type AiProviderAuthStyle = "bearer" | "x-api-key" | "query-key" | "none";

export type AiStructuredOutputMode =
  | "openai-json-schema"
  | "openai-json-object"
  | "gemini-json-mime"
  | "prompt-only";

export interface AiProviderPresetDefinition {
  family: AiApiFamily;
  defaultEndpoint: string;
  auth: AiProviderAuthStyle;
  defaultModel: string;
  structuredOutput?: AiStructuredOutputMode;
}

export const AI_PROVIDER_PRESETS: Record<AiProviderId, AiProviderPresetDefinition> = {
  openai: {
    family: "chat-completions",
    defaultEndpoint: "https://api.openai.com/v1/chat/completions",
    auth: "bearer",
    defaultModel: "gpt-4o-mini",
    structuredOutput: "openai-json-schema",
  },
  anthropic: {
    family: "messages",
    defaultEndpoint: "https://api.anthropic.com/v1/messages",
    auth: "x-api-key",
    defaultModel: "claude-sonnet-4-5",
    structuredOutput: "prompt-only",
  },
  gemini: {
    family: "generate-content",
    defaultEndpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    auth: "query-key",
    defaultModel: "gemini-1.5-flash",
    structuredOutput: "gemini-json-mime",
  },
  openrouter: {
    family: "chat-completions",
    defaultEndpoint: "https://openrouter.ai/api/v1/chat/completions",
    auth: "bearer",
    defaultModel: "openai/gpt-4o-mini",
    structuredOutput: "openai-json-object",
  },
  local: {
    family: "ollama-generate",
    defaultEndpoint: "http://localhost:11434/api/generate",
    auth: "none",
    defaultModel: "llama3.1",
    structuredOutput: "prompt-only",
  },
  mock: {
    family: "mock",
    defaultEndpoint: "",
    auth: "none",
    defaultModel: "heuristic",
  },
};

export function getProviderPreset(presetId: AiProviderId): AiProviderPresetDefinition {
  return AI_PROVIDER_PRESETS[presetId];
}
