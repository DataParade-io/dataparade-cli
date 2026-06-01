import { createAiProvider } from "../../../src/ai-enrichment/providers";
import { ChatCompletionsFamilyProvider } from "../../../src/ai-enrichment/providers/families/chat-completions-family";
import { MessagesFamilyProvider } from "../../../src/ai-enrichment/providers/families/messages-family";
import { GenerateContentFamilyProvider } from "../../../src/ai-enrichment/providers/families/generate-content-family";
import { OllamaGenerateFamilyProvider } from "../../../src/ai-enrichment/providers/families/ollama-generate-family";
import { MockAiProvider } from "../../../src/ai-enrichment/providers/mock";

describe("createAiProvider", () => {
  it("returns chat-completions family for openai preset", () => {
    expect(createAiProvider("openai")).toBeInstanceOf(ChatCompletionsFamilyProvider);
    expect(createAiProvider("openai").id).toBe("openai");
  });

  it("returns chat-completions family for openrouter preset", () => {
    const p = createAiProvider("openrouter");
    expect(p).toBeInstanceOf(ChatCompletionsFamilyProvider);
    expect(p.id).toBe("openrouter");
  });

  it("returns messages family for anthropic preset", () => {
    expect(createAiProvider("anthropic")).toBeInstanceOf(MessagesFamilyProvider);
  });

  it("returns generate-content family for gemini preset", () => {
    expect(createAiProvider("gemini")).toBeInstanceOf(GenerateContentFamilyProvider);
  });

  it("returns ollama-generate family for local preset", () => {
    expect(createAiProvider("local")).toBeInstanceOf(OllamaGenerateFamilyProvider);
  });

  it("returns mock for mock preset and unknown ids", () => {
    expect(createAiProvider("mock")).toBeInstanceOf(MockAiProvider);
    expect(createAiProvider("not-a-vendor")).toBeInstanceOf(MockAiProvider);
  });
});
