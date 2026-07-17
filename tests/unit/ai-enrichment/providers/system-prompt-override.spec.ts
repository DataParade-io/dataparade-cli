import { ChatCompletionsFamilyProvider } from "../../../../src/ai-enrichment/providers/families/chat-completions-family";
import { MessagesFamilyProvider } from "../../../../src/ai-enrichment/providers/families/messages-family";
import { resolveProviderConfig } from "../../../../src/ai-enrichment/providers/resolve-provider";
import {
  AI_PROVIDER_SYSTEM_PROMPT,
  buildAnthropicEnrichmentSystemPrompt,
} from "../../../../src/ai-enrichment/prompts/provider-enrichment-prompts";

/**
 * DP-P0-CLI-3813: provider families must honor a caller-supplied `systemPrompt`
 * (the DataParade backend owns it on the Platform AI path) and fall back to the
 * bundled prompt when none is given (BYOK path unchanged).
 */

const OVERRIDE = "SERVER-OWNED SYSTEM PROMPT (override)";

function jsonOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function lastRequestBody(fetchMock: jest.Mock): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("provider system prompt override (DP-P0-CLI-3813)", () => {
  const originalFetch = global.fetch;
  const userPrompt = JSON.stringify({ agent: "propertyAgent", candidates: [] });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  describe("OpenAI chat-completions", () => {
    it("uses the override when systemPrompt is set", async () => {
      const fetchMock = jest.fn(async () =>
        jsonOk({ choices: [{ message: { content: '{"proposals":[]}' } }] }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const provider = new ChatCompletionsFamilyProvider(
        resolveProviderConfig("openai", { apiKey: "sk-test" }),
      );
      await provider.infer({
        prompt: userPrompt,
        model: "gpt-4o-mini",
        apiKey: "sk-test",
        systemPrompt: OVERRIDE,
      });

      const body = lastRequestBody(fetchMock);
      const messages = body.messages as Array<{ role: string; content: string }>;
      expect(messages[0]).toEqual({ role: "system", content: OVERRIDE });
    });

    it("falls back to the bundled prompt when systemPrompt is absent (BYOK)", async () => {
      const fetchMock = jest.fn(async () =>
        jsonOk({ choices: [{ message: { content: '{"proposals":[]}' } }] }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const provider = new ChatCompletionsFamilyProvider(
        resolveProviderConfig("openai", { apiKey: "sk-test" }),
      );
      await provider.infer({
        prompt: userPrompt,
        model: "gpt-4o-mini",
        apiKey: "sk-test",
      });

      const body = lastRequestBody(fetchMock);
      const messages = body.messages as Array<{ role: string; content: string }>;
      expect(messages[0]).toEqual({
        role: "system",
        content: AI_PROVIDER_SYSTEM_PROMPT,
      });
    });
  });

  describe("Anthropic messages", () => {
    it("uses the override when systemPrompt is set", async () => {
      const fetchMock = jest.fn(async () =>
        jsonOk({ content: [{ type: "text", text: '{"proposals":[]}' }] }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const provider = new MessagesFamilyProvider(
        resolveProviderConfig("anthropic", { apiKey: "sk-ant" }),
      );
      await provider.infer({
        prompt: userPrompt,
        model: "claude-haiku-4-5",
        apiKey: "sk-ant",
        systemPrompt: OVERRIDE,
      });

      const body = lastRequestBody(fetchMock);
      expect(body.system).toBe(OVERRIDE);
    });

    it("falls back to the bundled Anthropic prompt when absent (BYOK)", async () => {
      const fetchMock = jest.fn(async () =>
        jsonOk({ content: [{ type: "text", text: '{"proposals":[]}' }] }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const provider = new MessagesFamilyProvider(
        resolveProviderConfig("anthropic", { apiKey: "sk-ant" }),
      );
      await provider.infer({
        prompt: userPrompt,
        model: "claude-haiku-4-5",
        apiKey: "sk-ant",
      });

      const body = lastRequestBody(fetchMock);
      expect(body.system).toBe(buildAnthropicEnrichmentSystemPrompt());
    });
  });
});
