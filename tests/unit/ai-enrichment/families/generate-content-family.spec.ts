import { GenerateContentFamilyProvider } from "../../../../src/ai-enrichment/providers/families/generate-content-family";
import { resolveProviderConfig } from "../../../../src/ai-enrichment/providers/resolve-provider";

describe("GenerateContentFamilyProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("does not call fetch when query-key auth has no API key", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const provider = new GenerateContentFamilyProvider(resolveProviderConfig("gemini"));
    const out = await provider.infer({
      prompt: "{}",
      model: "gemini-1.5-flash",
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(out).toEqual({ proposals: [] });
  });

  it("uses apiKey from resolved config when request omits it", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ proposals: [] }) }],
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const provider = new GenerateContentFamilyProvider(
      resolveProviderConfig("gemini", { apiKey: "gem-from-config" }),
    );
    await provider.infer({
      prompt: "{}",
      model: "gemini-1.5-flash",
    });

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain("key=gem-from-config");
  });

  it("calls generateContent endpoint and normalizes proposals", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    proposals: [
                      {
                        kind: "component_patch",
                        targetComponentId: "tp_1",
                        candidateType: "third_party",
                        setProperties: { integration_method: ["api"] },
                        propertyEvidence: {
                          integration_method: [
                            {
                              filePath: "src/index.ts",
                              startLine: 10,
                              endLine: 20,
                              reason: "api usage",
                            },
                          ],
                        },
                        confidence: { score: 0.82, band: "high" },
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const provider = new GenerateContentFamilyProvider(resolveProviderConfig("gemini"));
    const out = await provider.infer({
      prompt: JSON.stringify({ agent: "tpAgent", candidates: [] }),
      model: "gemini-1.5-flash",
      apiKey: "gem-key",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, reqInit] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/models/gemini-1.5-flash:generateContent");
    expect(url).toContain("key=gem-key");
    expect(reqInit.method).toBe("POST");
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0]?.kind).toBe("component_patch");
    if (out.proposals[0]?.kind === "component_patch") {
      expect(out.proposals[0].provider).toBe("gemini");
      expect(out.proposals[0].model).toBe("gemini-1.5-flash");
      expect(out.proposals[0].agent).toBe("tpAgent");
    }
  });

  it("returns [] when provider response is not parseable JSON proposals", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "not-json" }],
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const provider = new GenerateContentFamilyProvider(resolveProviderConfig("gemini"));
    const out = await provider.infer({
      prompt: "{}",
      model: "gemini-1.5-flash",
      apiKey: "gem-key",
    });
    expect(out).toEqual({ proposals: [] });
  });
});
