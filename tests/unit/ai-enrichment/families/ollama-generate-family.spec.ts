import { OllamaGenerateFamilyProvider } from "../../../../src/ai-enrichment/providers/families/ollama-generate-family";
import { resolveProviderConfig } from "../../../../src/ai-enrichment/providers/resolve-provider";

describe("OllamaGenerateFamilyProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("calls Ollama /api/generate and normalizes proposals", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
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
                    endLine: 4,
                    reason: "dependency",
                  },
                ],
              },
              confidence: { score: 0.8, band: "high" },
            },
          ],
        }),
      }),
    }) as unknown as typeof fetch;

    const provider = new OllamaGenerateFamilyProvider(resolveProviderConfig("local"));
    const out = await provider.infer({
      prompt: JSON.stringify({ agent: "tpAgent", candidates: [] }),
      model: "llama3.1",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, reqInit] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://localhost:11434/api/generate");
    const parsed = JSON.parse(reqInit.body as string) as {
      stream?: boolean;
      options?: { num_predict?: number };
      prompt?: string;
    };
    expect(parsed.stream).toBe(false);
    expect(parsed.options?.num_predict).toBeDefined();
    expect(parsed.prompt).toContain("You are enriching a DataParade data-flow scan.");

    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0]?.kind).toBe("component_patch");
    if (out.proposals[0]?.kind === "component_patch") {
      expect(out.proposals[0].provider).toBe("local");
      expect(out.proposals[0].agent).toBe("tpAgent");
    }
  });

  it("returns [] for invalid local JSON output", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: "{invalid" }),
    }) as unknown as typeof fetch;

    const provider = new OllamaGenerateFamilyProvider(resolveProviderConfig("local"));
    const out = await provider.infer({
      prompt: "{}",
      model: "llama3.1",
    });
    expect(out).toEqual({ proposals: [] });
  });
});
