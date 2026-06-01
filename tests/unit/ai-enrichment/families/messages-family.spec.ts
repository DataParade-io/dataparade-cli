import { MessagesFamilyProvider } from "../../../../src/ai-enrichment/providers/families/messages-family";
import { resolveProviderConfig } from "../../../../src/ai-enrichment/providers/resolve-provider";

describe("MessagesFamilyProvider", () => {
  const originalFetch = global.fetch;

  function provider(): MessagesFamilyProvider {
    return new MessagesFamilyProvider(resolveProviderConfig("anthropic"));
  }

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("returns [] without API key", async () => {
    const p = provider();
    await expect(
      p.infer({
        prompt: "{}",
        model: "claude-sonnet-4-6",
      }),
    ).resolves.toEqual({ proposals: [] });
  });

  it("uses apiKey from resolved config when request omits it", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: '{"proposals":[]}' }],
      }),
    }) as unknown as typeof fetch;

    const p = new MessagesFamilyProvider(
      resolveProviderConfig("anthropic", { apiKey: "sk-ant-config" }),
    );
    await p.infer({
      prompt: "{}",
      model: "claude-sonnet-4-6",
    });

    const [, reqInit] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(reqInit.headers).toMatchObject({
      "x-api-key": "sk-ant-config",
    });
  });

  it("calls Anthropic messages API and normalizes proposals", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              proposals: [
                {
                  kind: "component_patch",
                  targetComponentId: "tp_1",
                  candidateType: "third_party",
                  setProperties: { integration_method: ["sdk"] },
                  propertyEvidence: {
                    integration_method: [
                      {
                        filePath: "package.json",
                        startLine: 1,
                        endLine: 3,
                        reason: "dependency declaration",
                      },
                    ],
                  },
                  confidence: { score: 0.85, band: "high" },
                },
              ],
            }),
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const p = provider();
    const out = await p.infer({
      prompt: JSON.stringify({ agent: "tpAgent", candidates: [] }),
      model: "claude-sonnet-4-6",
      apiKey: "sk-ant-test",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, reqInit] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/v1/messages");
    expect(reqInit.headers).toMatchObject({
      "content-type": "application/json",
      "x-api-key": "sk-ant-test",
      "anthropic-version": "2023-06-01",
    });

    const body = JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1]?.body));
    expect(body.max_tokens).toBeGreaterThanOrEqual(4096);
    expect(String(body.system)).toContain("Output discipline");

    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0]?.kind).toBe("component_patch");
    if (out.proposals[0]?.kind === "component_patch") {
      expect(out.proposals[0].provider).toBe("anthropic");
      expect(out.proposals[0].model).toBe("claude-sonnet-4-6");
      expect(out.proposals[0].agent).toBe("tpAgent");
      expect(out.proposals[0].targetComponentId).toBe("tp_1");
    }
  });

  it("clamps max_tokens when DATAPARADE_AI_MAX_TOKENS is very low", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: '{"proposals":[]}' }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    }) as unknown as typeof fetch;

    const p = provider();
    await p.infer({
      prompt: "{}",
      model: "claude-sonnet-4-6",
      apiKey: "sk-ant-test",
      maxTokens: 200,
    });

    const body = JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1]?.body));
    expect(body.max_tokens).toBe(4096);
  });

  it("returns [] on HTTP error", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"invalid"}}',
    }) as unknown as typeof fetch;

    const p = provider();
    const out = await p.infer({
      prompt: "{}",
      model: "claude-sonnet-4-6",
      apiKey: "sk-ant-bad",
    });
    expect(out).toEqual({ proposals: [] });
  });
});
