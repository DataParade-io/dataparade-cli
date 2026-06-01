import {
  resolveChatCompletionsEndpoint,
  resolveGeminiGenerateContentEndpoint,
  shouldUseChatCompletionsJsonShim,
} from "../../../src/ai-enrichment/providers/endpoint-resolution";
import { AI_PROVIDER_PRESETS } from "../../../src/ai-enrichment/providers/presets";

describe("endpoint-resolution", () => {
  const openaiDefault = AI_PROVIDER_PRESETS.openai.defaultEndpoint;
  const geminiDefault = AI_PROVIDER_PRESETS.gemini.defaultEndpoint;

  describe("resolveChatCompletionsEndpoint", () => {
    it("uses preset default when endpoint is empty", () => {
      expect(resolveChatCompletionsEndpoint(undefined, openaiDefault)).toBe(openaiDefault);
      expect(resolveChatCompletionsEndpoint("", openaiDefault)).toBe(openaiDefault);
    });

    it("rewrites bare api.openai.com host to preset default", () => {
      expect(resolveChatCompletionsEndpoint("https://api.openai.com", openaiDefault)).toBe(
        openaiDefault,
      );
    });

    it("keeps explicit chat/completions URLs", () => {
      const custom = "https://proxy.example/v1/chat/completions";
      expect(resolveChatCompletionsEndpoint(custom, openaiDefault)).toBe(custom);
    });

    it("keeps non-OpenAI custom gateways unchanged", () => {
      const groq = "https://api.groq.com/openai/v1/chat/completions";
      expect(resolveChatCompletionsEndpoint(groq, openaiDefault)).toBe(groq);
    });
  });

  describe("shouldUseChatCompletionsJsonShim", () => {
    it("returns false for chat/completions URLs", () => {
      expect(shouldUseChatCompletionsJsonShim(openaiDefault)).toBe(false);
    });

    it("returns true for legacy shim gateways", () => {
      expect(shouldUseChatCompletionsJsonShim("https://custom.gateway/infer")).toBe(true);
    });
  });

  describe("resolveGeminiGenerateContentEndpoint", () => {
    it("builds URL from preset base and model", () => {
      const url = resolveGeminiGenerateContentEndpoint(undefined, "gemini-1.5-flash", geminiDefault);
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
      );
    });

    it("appends model to base ending in /models", () => {
      const url = resolveGeminiGenerateContentEndpoint(geminiDefault, "gemini-pro", geminiDefault);
      expect(url).toContain("/models/gemini-pro:generateContent");
    });

    it("returns full URL when :generateContent already present", () => {
      const full =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
      expect(resolveGeminiGenerateContentEndpoint(full, "ignored", geminiDefault)).toBe(full);
    });
  });
});
