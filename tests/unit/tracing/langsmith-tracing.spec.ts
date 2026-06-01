import {
  buildLangSmithAiInferenceTraceSummary,
  buildLangSmithInferencePipelineTraceSummary,
  buildLangSmithScanTraceSummary,
  isLangSmithTracingEnabled,
} from "../../../src/tracing/langsmith-tracing";
import type { OrchestratorScanResult } from "../../../src/core/pipeline/orchestrator-result";

describe("tracing/langsmith-tracing", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LANGSMITH_API_KEY;
    delete process.env.LANGCHAIN_API_KEY;
    delete process.env.LANGCHAIN_TRACING_V2;
    delete process.env.LANGSMITH_TRACING;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("isLangSmithTracingEnabled requires key and tracing flag", () => {
    expect(isLangSmithTracingEnabled()).toBe(false);

    process.env.LANGSMITH_API_KEY = "test-key";
    expect(isLangSmithTracingEnabled()).toBe(false);

    process.env.LANGCHAIN_TRACING_V2 = "true";
    expect(isLangSmithTracingEnabled()).toBe(true);
  });

  it("buildLangSmithScanTraceSummary omits full component payloads", () => {
    const result: OrchestratorScanResult = {
      files: [],
      findings: [{ pattern: "x", name: "n", confidence: 1, properties: {} } as never],
      scanResult: {
        components: [
          {
            id: "cmp_1",
            name: "Payments API",
            type: "asset",
            confidence: 0.9,
            detectedFrom: [],
            sourceLocations: [],
            properties: { section_id: "packages/server" },
          },
        ],
        dataFlows: [],
        filesScanned: 42,
        filesSkipped: 1,
        totalLines: 100,
        scanDurationMs: 500,
        warnings: ["w1"],
        errors: [],
        aiInferenceSummary: {
          ran: true,
          candidatesConsidered: 3,
          proposalsGenerated: 2,
          proposalsApplied: 1,
          proposalsRejected: 1,
          proposalsGeneratedHeuristic: 1,
          proposalsAppliedHeuristic: 1,
          proposalsGeneratedProvider: 1,
          proposalsAppliedProvider: 0,
          providerCalls: 1,
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          aiProvider: "mock",
          aiModel: "heuristic",
        },
      },
    };

    const summary = buildLangSmithScanTraceSummary(result);
    expect(summary.filesScanned).toBe(42);
    expect(summary.componentCount).toBe(1);
    expect(summary.findingCount).toBe(1);
    expect(summary.sectionIds).toEqual(["packages/server"]);
    expect(summary).not.toHaveProperty("components");
    expect((summary.aiInference as { proposalsGenerated: number }).proposalsGenerated).toBe(2);
  });

  it("buildLangSmithInferencePipelineTraceSummary summarizes pipeline output", () => {
    const summary = buildLangSmithInferencePipelineTraceSummary({
      candidates: [{ id: "c1" } as never],
      plan: { queues: [], droppedCandidates: [] },
      proposals: [{ id: "p1", proposal: {} as never }],
      mergeResult: {
        components: [],
        dataFlows: [],
        appliedProposalIds: ["p1"],
        rejectedProposalIds: [],
        provenanceByTarget: {},
      },
      usageSummary: {
        providerCalls: 2,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      },
    });

    expect(summary.candidateCount).toBe(1);
    expect(summary.proposalCount).toBe(1);
    expect(summary.appliedProposalCount).toBe(1);
    expect(summary.usageSummary).toEqual(
      expect.objectContaining({ providerCalls: 2, totalTokens: 150 }),
    );
  });

  it("buildLangSmithAiInferenceTraceSummary copies summary counters", () => {
    const summary = buildLangSmithAiInferenceTraceSummary({
      ran: true,
      candidatesConsidered: 5,
      proposalsGenerated: 4,
      proposalsApplied: 2,
      proposalsRejected: 2,
      proposalsGeneratedHeuristic: 2,
      proposalsAppliedHeuristic: 1,
      proposalsGeneratedProvider: 2,
      proposalsAppliedProvider: 1,
      providerCalls: 2,
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      aiProvider: "openai",
      aiModel: "gpt-4",
    });

    expect(summary.proposalsGenerated).toBe(4);
    expect(summary.aiProvider).toBe("openai");
  });
});
