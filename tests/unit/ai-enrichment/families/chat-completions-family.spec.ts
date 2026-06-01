import { ChatCompletionsFamilyProvider } from "../../../../src/ai-enrichment/providers/families/chat-completions-family";
import { resolveProviderConfig } from "../../../../src/ai-enrichment/providers/resolve-provider";

describe("ChatCompletionsFamilyProvider", () => {
  const originalFetch = global.fetch;
  const originalJsonSchema = process.env.DATAPARADE_AI_OPENAI_JSON_SCHEMA;

  function provider(): ChatCompletionsFamilyProvider {
    return new ChatCompletionsFamilyProvider(resolveProviderConfig("openai"));
  }

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalJsonSchema === undefined) {
      delete process.env.DATAPARADE_AI_OPENAI_JSON_SCHEMA;
    } else {
      process.env.DATAPARADE_AI_OPENAI_JSON_SCHEMA = originalJsonSchema;
    }
    jest.restoreAllMocks();
  });

  it("returns [] without API key", async () => {
    const p = provider();
    await expect(
      p.infer({
        prompt: "{}",
        model: "gpt-4o-mini",
      }),
    ).resolves.toEqual({ proposals: [] });
  });

  it("calls OpenRouter chat/completions endpoint for openrouter preset", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ proposals: [] }) } }],
      }),
    }) as unknown as typeof fetch;

    const p = new ChatCompletionsFamilyProvider(resolveProviderConfig("openrouter"));
    await p.infer({
      prompt: "{}",
      model: "openai/gpt-4o-mini",
      apiKey: "sk-or-test",
    });

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const [, reqInit] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(reqInit.body as string) as { model?: string };
    expect(body.model).toBe("openai/gpt-4o-mini");
  });

  it("uses apiKey from resolved config when request omits it", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ proposals: [] }) } }],
      }),
    }) as unknown as typeof fetch;

    const p = new ChatCompletionsFamilyProvider(
      resolveProviderConfig("openai", { apiKey: "sk-from-config" }),
    );
    await p.infer({
      prompt: "{}",
      model: "gpt-4o-mini",
    });

    const [, reqInit] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(reqInit.headers).toMatchObject({
      authorization: "Bearer sk-from-config",
    });
  });

  it("parses chat completions JSON and normalizes proposals", async () => {
    const proposals = [
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
              endLine: 5,
              reason: "dependency declaration",
            },
          ],
        },
        confidence: { score: 0.85, band: "high" },
      },
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ proposals }),
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const p = provider();
    const out = await p.infer({
      prompt: JSON.stringify({ agent: "tpAgent", candidates: [] }),
      model: "gpt-4o-mini",
      apiKey: "sk-test",
    });

    expect(global.fetch).toHaveBeenCalled();
    const [, reqInit] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain("chat/completions");
    const parsedBody = JSON.parse(reqInit.body as string) as {
      response_format?: { type: string; json_schema?: { name: string } };
    };
    expect(parsedBody.response_format?.type).toBe("json_schema");
    expect(parsedBody.response_format?.json_schema?.name).toBe("dataparade_proposals");
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0]?.kind).toBe("component_patch");
    if (out.proposals[0]?.kind === "component_patch") {
      expect(out.proposals[0].targetComponentId).toBe("tp_1");
      expect(out.proposals[0].provider).toBe("openai");
      expect(out.proposals[0].model).toBe("gpt-4o-mini");
      expect(out.proposals[0].agent).toBe("tpAgent");
    }
  });

  it("drops proposals with no evidence", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                proposals: [
                  {
                    kind: "component_patch",
                    targetComponentId: "x",
                    candidateType: "third_party",
                    setProperties: { a: 1 },
                    propertyEvidence: {},
                    confidence: { score: 0.9, band: "high" },
                  },
                ],
              }),
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const p = provider();
    const out = await p.infer({
      prompt: "{}",
      model: "gpt-4o-mini",
      apiKey: "sk-test",
    });
    expect(out).toEqual({ proposals: [] });
  });

  it("drops placeholder-only setProperties from provider output", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                proposals: [
                  {
                    kind: "component_patch",
                    targetComponentId: "x",
                    candidateType: "node_property",
                    setProperties: {
                      inference_status: "needs_review",
                      access_controls_for_delivery: null,
                      api_versioning_strategy: "none",
                      cloud_services_used: [],
                    },
                    propertyEvidence: {},
                    confidence: { score: 0.9, band: "high" },
                  },
                ],
              }),
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const p = provider();
    const out = await p.infer({
      prompt: "{}",
      model: "gpt-4o-mini",
      apiKey: "sk-test",
    });
    expect(out).toEqual({ proposals: [] });
  });

  it("uses json_object when DATAPARADE_AI_OPENAI_JSON_SCHEMA=0", async () => {
    process.env.DATAPARADE_AI_OPENAI_JSON_SCHEMA = "0";

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ proposals: [] }) } }],
      }),
    }) as unknown as typeof fetch;

    const p = provider();
    await p.infer({
      prompt: "{}",
      model: "gpt-4o-mini",
      apiKey: "sk-test",
    });

    const [, reqInit] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const parsedBody = JSON.parse(reqInit.body as string) as {
      response_format?: { type: string };
    };
    expect(parsedBody.response_format?.type).toBe("json_object");
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
      model: "gpt-4o-mini",
      apiKey: "sk-bad",
    });
    expect(out).toEqual({ proposals: [] });
  });
});
