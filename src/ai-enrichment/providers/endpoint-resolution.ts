/**
 * Family-specific endpoint normalization. Defaults come from {@link AI_PROVIDER_PRESETS};
 * these helpers only apply path/shape rules (e.g. bare OpenAI host → chat/completions URL).
 */

/** Normalize an OpenAI-style chat-completions URL (preset default is the canonical full path). */
export function resolveChatCompletionsEndpoint(
  endpoint: string | undefined,
  presetDefaultEndpoint: string,
): string {
  const raw = endpoint?.trim();
  if (!raw) return presetDefaultEndpoint;
  if (raw.includes("chat/completions")) return raw;
  if (raw.includes("api.openai.com")) return presetDefaultEndpoint;
  return raw;
}

/** True when the URL is not a chat/completions path (legacy `{ model, prompt }` shim). */
export function shouldUseChatCompletionsJsonShim(url: string): boolean {
  return !url.toLowerCase().includes("chat/completions");
}

/**
 * Build a Gemini `generateContent` URL from a preset base (or full URL) and model id.
 * `presetDefaultEndpoint` is typically `…/v1beta/models` without the model suffix.
 */
export function resolveGeminiGenerateContentEndpoint(
  endpoint: string | undefined,
  model: string,
  presetDefaultEndpoint: string,
): string {
  const raw = endpoint?.trim() || presetDefaultEndpoint;
  if (raw.includes(":generateContent")) return raw;
  const trimmed = raw.endsWith("/") ? raw.slice(0, -1) : raw;

  if (trimmed.endsWith("/models")) {
    return `${trimmed}/${encodeURIComponent(model)}:generateContent`;
  }
  if (trimmed.includes("/models/")) {
    return `${trimmed}:generateContent`;
  }
  return `${trimmed}/${encodeURIComponent(model)}:generateContent`;
}
