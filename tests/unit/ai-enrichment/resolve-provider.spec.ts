import {
  resolveInferApiKey,
  resolveProviderConfig,
} from "../../../src/ai-enrichment/providers/resolve-provider";
import { AI_PROVIDER_PRESETS } from "../../../src/ai-enrichment/providers/presets";

describe("resolveProviderConfig", () => {
  it("resolves openai preset to chat-completions family with defaults", () => {
    const cfg = resolveProviderConfig("openai");
    expect(cfg.presetId).toBe("openai");
    expect(cfg.family).toBe("chat-completions");
    expect(cfg.endpoint).toBe(AI_PROVIDER_PRESETS.openai.defaultEndpoint);
    expect(cfg.model).toBe("gpt-4o-mini");
    expect(cfg.auth).toBe("bearer");
    expect(cfg.structuredOutput).toBe("openai-json-schema");
  });

  it("resolves anthropic preset to messages family", () => {
    const cfg = resolveProviderConfig("anthropic");
    expect(cfg.family).toBe("messages");
    expect(cfg.auth).toBe("x-api-key");
    expect(cfg.model).toBe("claude-sonnet-4-5");
  });

  it("resolves openrouter preset to chat-completions family", () => {
    const cfg = resolveProviderConfig("openrouter");
    expect(cfg.presetId).toBe("openrouter");
    expect(cfg.family).toBe("chat-completions");
    expect(cfg.endpoint).toBe(AI_PROVIDER_PRESETS.openrouter.defaultEndpoint);
    expect(cfg.model).toBe("openai/gpt-4o-mini");
    expect(cfg.auth).toBe("bearer");
  });

  it("resolves gemini preset to generate-content family", () => {
    const cfg = resolveProviderConfig("gemini");
    expect(cfg.family).toBe("generate-content");
    expect(cfg.auth).toBe("query-key");
  });

  it("resolves local preset to ollama-generate family", () => {
    const cfg = resolveProviderConfig("local");
    expect(cfg.family).toBe("ollama-generate");
    expect(cfg.endpoint).toContain("11434");
  });

  it("applies endpoint and model overrides", () => {
    const cfg = resolveProviderConfig("openai", {
      endpoint: "https://custom.example/v1/chat/completions",
      model: "gpt-4o",
      apiKey: "sk-test",
    });
    expect(cfg.endpoint).toBe("https://custom.example/v1/chat/completions");
    expect(cfg.model).toBe("gpt-4o");
    expect(cfg.apiKey).toBe("sk-test");
  });

  it("normalizes bare OpenAI host to preset chat/completions URL at resolve time", () => {
    const cfg = resolveProviderConfig("openai", {
      endpoint: "https://api.openai.com",
    });
    expect(cfg.endpoint).toBe(AI_PROVIDER_PRESETS.openai.defaultEndpoint);
  });

  it("resolveInferApiKey prefers request over resolved config", () => {
    const resolved = resolveProviderConfig("openai", { apiKey: "sk-config" });
    expect(resolveInferApiKey({ apiKey: "sk-request" }, resolved)).toBe("sk-request");
    expect(resolveInferApiKey({}, resolved)).toBe("sk-config");
    expect(resolveInferApiKey({}, resolveProviderConfig("openai"))).toBeUndefined();
  });

  it("falls back unknown preset id to mock", () => {
    const cfg = resolveProviderConfig("unknown-vendor");
    expect(cfg.presetId).toBe("mock");
    expect(cfg.family).toBe("mock");
    expect(cfg.model).toBe("heuristic");
  });
});
