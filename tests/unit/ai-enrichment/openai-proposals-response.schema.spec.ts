import {
  getOpenAiProposalsResponseJsonSchemaForApi,
  openAiProposalsResponseSchema,
} from "../../../src/ai-enrichment/openai-proposals-response.schema";

describe("openAiProposalsResponseSchema", () => {
  it("parses a minimal valid component_patch payload", () => {
    const r = openAiProposalsResponseSchema.safeParse({
      proposals: [
        {
          kind: "component_patch",
          targetComponentId: "c1",
          candidateType: "third_party",
          setProperties: { integration_method: ["api"] },
          propertyEvidence: {
            integration_method: [
              { filePath: "a.ts", startLine: 1, endLine: 2, reason: "uses SDK" },
            ],
          },
          confidence: { score: 0.8, band: "high" },
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("getOpenAiProposalsResponseJsonSchemaForApi omits $schema", () => {
    const j = getOpenAiProposalsResponseJsonSchemaForApi();
    expect(j.name).toBe("dataparade_proposals");
    expect(j.schema.$schema).toBeUndefined();
    expect(j.schema.type).toBe("object");
  });
});
