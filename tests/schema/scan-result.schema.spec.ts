import {
  fileInfoSchema,
  validateScanResult,
} from "../../src/core/schema/scan-result.schema";

describe("scanResultSchema", () => {
  it("accepts a minimal valid scan result", () => {
    const input = {
      components: [
        {
          id: "comp-1",
          name: "Application",
          type: "asset",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {},
        },
      ],
      dataFlows: [],
      filesScanned: 10,
      filesSkipped: 0,
      totalLines: 100,
      scanDurationMs: 50,
      warnings: [],
      errors: [],
    };

    const result = validateScanResult(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.components[0].id).toBe("comp-1");
    }
  });

  it("rejects invalid numeric fields", () => {
    const input = {
      components: [],
      dataFlows: [],
      filesScanned: -1,
      filesSkipped: 0,
      totalLines: 100,
      scanDurationMs: 50,
      warnings: [],
      errors: [],
    };

    const result = validateScanResult(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const message = result.errors.join(" | ");
      expect(message).toMatch(/filesScanned/);
    }
  });

  it("accepts python in file info schema", () => {
    const input = {
      path: "service/app.py",
      name: "app.py",
      content: "print('ok')",
      language: "python",
      size: 11,
    };

    const result = fileInfoSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("accepts third-party property coverage in aiInferenceSummary", () => {
    const input = {
      components: [],
      dataFlows: [],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 1,
      scanDurationMs: 5,
      warnings: [],
      errors: [],
      aiInferenceSummary: {
        ran: true,
        candidatesConsidered: 2,
        proposalsGenerated: 2,
        proposalsApplied: 1,
        proposalsRejected: 1,
        proposalsGeneratedHeuristic: 1,
        proposalsAppliedHeuristic: 1,
        proposalsGeneratedProvider: 1,
        proposalsAppliedProvider: 0,
        providerCalls: 1,
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        aiProvider: "openai",
        aiModel: "gpt",
        thirdPartyPropertyCoverage: {
          autofilled: { vendor: 1 },
          suggested: { api_type: 1 },
          unknown: { vendor_soc2_iso27001: 3 },
        },
        agenticTrace: [
          {
            candidateId: "cand_1",
            componentId: "tp_1",
            filesReviewed: ["src/payments.ts"],
            rounds: 2,
            finalProposalCount: 1,
            toolCalls: [
              {
                round: 1,
                action: "search_text",
                detail: "Search term: stripe",
                filesTouched: ["src/payments.ts"],
                stats: { hits: 1 },
              },
            ],
          },
        ],
      },
    };
    const result = validateScanResult(input);
    expect(result.ok).toBe(true);
  });

  it("accepts third-party data flow summary in aiInferenceSummary", () => {
    const input = {
      components: [],
      dataFlows: [],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 1,
      scanDurationMs: 5,
      warnings: [],
      errors: [],
      aiInferenceSummary: {
        ran: true,
        candidatesConsidered: 1,
        proposalsGenerated: 1,
        proposalsApplied: 1,
        proposalsRejected: 0,
        proposalsGeneratedHeuristic: 0,
        proposalsAppliedHeuristic: 0,
        proposalsGeneratedProvider: 1,
        proposalsAppliedProvider: 1,
        providerCalls: 1,
        inputTokens: 8,
        outputTokens: 5,
        totalTokens: 13,
        aiProvider: "openai",
        aiModel: "gpt",
        thirdPartyDataFlow: {
          entries: [
            {
              componentId: "cmp_tp_1",
              componentName: "Supabase",
              capabilities: ["auth", "storage"],
              direction: "outbound_to_third_party",
              dataShared: [
                {
                  category: "credentials",
                  labels: ["user_email", "user_password"],
                },
              ],
              confidence: 0.89,
              confidenceBand: "high",
              source: "provider_plus_heuristic",
              evidence: [
                {
                  filePath: "src/auth/supabase.ts",
                  startLine: 12,
                  endLine: 12,
                  reason: "matched credentials signal",
                },
              ],
            },
          ],
          totals: {
            thirdPartiesAnalyzed: 1,
            withDataShared: 1,
          },
        },
      },
    };
    const result = validateScanResult(input);
    expect(result.ok).toBe(true);
  });
});

