import { generateAgenticProposals } from "../../../src/ai-enrichment/agent-orchestrator";
import { ChatCompletionsFamilyProvider } from "../../../src/ai-enrichment/providers/families/chat-completions-family";
import type { DetectedComponent } from "../../../src/core/types/component";

function tpCandidate(id: string, componentId: string) {
  return {
    id,
    candidateType: "third_party" as const,
    priority: 90,
    componentId,
    missingFields: [] as string[],
    rationale: "r",
    hints: [] as string[],
  };
}

function propertyCandidate(id: string, componentId: string) {
  return {
    id,
    candidateType: "node_property" as const,
    priority: 50,
    componentId,
    missingFields: ["encryption_at_rest"] as string[],
    rationale: "r",
    hints: [] as string[],
  };
}

describe("generateAgenticProposals", () => {
  let inferSpy: jest.SpiedFunction<ChatCompletionsFamilyProvider["infer"]>;

  beforeEach(() => {
    inferSpy = jest
      .spyOn(ChatCompletionsFamilyProvider.prototype, "infer")
      .mockResolvedValue({ proposals: [] });
  });

  afterEach(() => {
    inferSpy.mockRestore();
  });

  it("invokes the provider once per third-party queue item (tpAgent)", async () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_a",
        name: "A",
        type: "third_party",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { vendor: null },
      },
      {
        id: "tp_b",
        name: "B",
        type: "third_party",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { vendor: null },
      },
    ];
    const c1 = tpCandidate("c1", "tp_a");
    const c2 = tpCandidate("c2", "tp_b");

    await generateAgenticProposals(
      { components, dataFlows: [] },
      {
        queues: [
          {
            agent: "tpAgent",
            queue: [c1, c2],
            budgetTokens: 200_000,
            maxModelCalls: 10,
          },
        ],
        droppedCandidates: [],
      },
      [c1, c2],
      {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test",
        toolLoopMaxRounds: 1,
      },
    );

    expect(inferSpy).toHaveBeenCalledTimes(2);
    for (const call of inferSpy.mock.calls) {
      const payload = JSON.parse(call[0]!.prompt) as { candidates: unknown[] };
      expect(payload.candidates).toHaveLength(1);
    }
  });

  it("batches propertyAgent into a single infer call", async () => {
    const components: DetectedComponent[] = [
      {
        id: "asset_1",
        name: "DB",
        type: "asset",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: {},
      },
      {
        id: "asset_2",
        name: "Cache",
        type: "asset",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: {},
      },
    ];
    const c1 = propertyCandidate("p1", "asset_1");
    const c2 = propertyCandidate("p2", "asset_2");

    await generateAgenticProposals(
      { components, dataFlows: [] },
      {
        queues: [
          {
            agent: "propertyAgent",
            queue: [c1, c2],
            budgetTokens: 200_000,
            maxModelCalls: 10,
          },
        ],
        droppedCandidates: [],
      },
      [c1, c2],
      {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test",
        toolLoopMaxRounds: 1,
      },
    );

    expect(inferSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(inferSpy.mock.calls[0]![0].prompt) as {
      candidates: unknown[];
    };
    expect(payload.candidates).toHaveLength(2);
  });

  it("respects maxModelCalls limit for tpAgent provider calls", async () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_a",
        name: "A",
        type: "third_party",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { vendor: null },
      },
      {
        id: "tp_b",
        name: "B",
        type: "third_party",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { vendor: null },
      },
      {
        id: "tp_c",
        name: "C",
        type: "third_party",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { vendor: null },
      },
    ];
    const c1 = tpCandidate("c1", "tp_a");
    const c2 = tpCandidate("c2", "tp_b");
    const c3 = tpCandidate("c3", "tp_c");

    await generateAgenticProposals(
      { components, dataFlows: [] },
      {
        queues: [
          {
            agent: "tpAgent",
            queue: [c1, c2, c3],
            budgetTokens: 100_000,
            maxModelCalls: 2,
          },
        ],
        droppedCandidates: [],
      },
      [c1, c2, c3],
      {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test",
        toolLoopMaxRounds: 1,
      },
    );

    expect(inferSpy).toHaveBeenCalledTimes(2);
  });

  it("respects budgetTokens and skips provider calls when budget is exhausted", async () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_a",
        name: "A",
        type: "third_party",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { vendor: null },
      },
    ];
    const c1 = tpCandidate("c1", "tp_a");

    await generateAgenticProposals(
      { components, dataFlows: [] },
      {
        queues: [
          {
            agent: "tpAgent",
            queue: [c1],
            budgetTokens: 1,
            maxModelCalls: 1,
          },
        ],
        droppedCandidates: [],
      },
      [c1],
      {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test",
        toolLoopMaxRounds: 1,
      },
    );

    expect(inferSpy).toHaveBeenCalledTimes(0);
  });

  it("invokes the provider for interactionAgent when the queue is eligible", async () => {
    const components: DetectedComponent[] = [
      {
        id: "asset_1",
        name: "A",
        type: "asset",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: {},
      },
    ];
    const interactionCandidate = {
      id: "m1",
      candidateType: "missing_interaction" as const,
      priority: 80,
      missingFields: [] as string[],
      rationale: "r",
      hints: ["frontend", "backend"],
    };

    await generateAgenticProposals(
      { components, dataFlows: [] },
      {
        queues: [
          {
            agent: "interactionAgent",
            queue: [interactionCandidate],
            budgetTokens: 200_000,
            maxModelCalls: 10,
          },
        ],
        droppedCandidates: [],
      },
      [interactionCandidate],
      {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test",
        toolLoopMaxRounds: 1,
      },
    );

    expect(inferSpy).toHaveBeenCalledTimes(1);
  });

  it("aggregates provider token usage across calls", async () => {
    inferSpy.mockResolvedValue({
      proposals: [],
      usage: {
        inputTokens: 100,
        outputTokens: 25,
        totalTokens: 125,
        estimatedCostUsd: 0.001,
      },
    });
    const components: DetectedComponent[] = [
      {
        id: "tp_a",
        name: "A",
        type: "third_party",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { vendor: null },
      },
      {
        id: "tp_b",
        name: "B",
        type: "third_party",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { vendor: null },
      },
    ];
    const c1 = tpCandidate("c1", "tp_a");
    const c2 = tpCandidate("c2", "tp_b");

    const out = await generateAgenticProposals(
      { components, dataFlows: [] },
      {
        queues: [
          {
            agent: "tpAgent",
            queue: [c1, c2],
            budgetTokens: 200_000,
            maxModelCalls: 10,
          },
        ],
        droppedCandidates: [],
      },
      [c1, c2],
      {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test",
        toolLoopMaxRounds: 1,
      },
    );

    expect(out.usageSummary).toMatchObject({
      providerCalls: 2,
      inputTokens: 200,
      outputTokens: 50,
      totalTokens: 250,
      estimatedCostUsd: 0.002,
    });
    expect(out.usageSummary?.agenticTrace?.length).toBe(2);
  });

  it("adds deterministic third-party heuristic proposals with evidence", async () => {
    inferSpy.mockResolvedValue({ proposals: [] });
    const components: DetectedComponent[] = [
      {
        id: "tp_stripe",
        name: "Stripe",
        type: "third_party",
        confidence: 0.9,
        detectedFrom: [
          {
            pattern: "external_api_call",
            sourceLocation: {
              filePath: "backend/payments/index.ts",
              startLine: 1,
              endLine: 1,
            },
          },
        ],
        sourceLocations: [
          { filePath: "backend/payments/index.ts", startLine: 1, endLine: 1 },
        ],
        properties: {
          section_id: "backend/payments",
          vendor: null,
          api_type: null,
          authentication_method: null,
          integration_method: [],
        },
      },
    ];
    const out = await generateAgenticProposals(
      {
        components,
        dataFlows: [],
        files: [
          {
            path: "backend/payments/index.ts",
            name: "index.ts",
            language: "typescript",
            size: 180,
            content: [
              'import Stripe from "stripe";',
              'await fetch("https://api.stripe.com/v1/customers", {',
              "  headers: { Authorization: `Bearer ${process.env.STRIPE_API_KEY}` },",
              "});",
            ].join("\n"),
          },
          {
            path: "backend/payments/package.json",
            name: "package.json",
            language: "json",
            size: 60,
            content: JSON.stringify({ dependencies: { stripe: "^17.0.0" } }),
          },
        ],
      },
      {
        queues: [
          {
            agent: "tpAgent",
            queue: [tpCandidate("c1", "tp_stripe")],
            budgetTokens: 200_000,
            maxModelCalls: 1,
          },
        ],
        droppedCandidates: [],
      },
      [tpCandidate("c1", "tp_stripe")],
      {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test",
        toolLoopMaxRounds: 1,
      },
    );

    const heuristic = out.proposals.find((item) => item.id.startsWith("heuristic_"));
    expect(heuristic).toBeDefined();
    expect(heuristic?.proposal.kind).toBe("component_patch");
    if (heuristic?.proposal.kind === "component_patch") {
      expect(Object.keys(heuristic.proposal.setProperties).length).toBeGreaterThan(0);
      expect(heuristic.proposal.evidence.length).toBeGreaterThan(0);
      expect(heuristic.proposal.provider).toBe("mock");
      expect(heuristic.proposal.agent).toBe("tpAgent");
    }
  });

  it("persists agentic trace for tp tool loop runs", async () => {
    inferSpy.mockResolvedValue({ proposals: [] });
    const components: DetectedComponent[] = [
      {
        id: "tp_trace",
        name: "Stripe",
        type: "third_party",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [{ filePath: "src/payments.ts", startLine: 1, endLine: 1 }],
        properties: { vendor: null },
      },
    ];
    const out = await generateAgenticProposals(
      {
        components,
        dataFlows: [],
        files: [
          {
            path: "src/payments.ts",
            name: "payments.ts",
            language: "typescript",
            size: 64,
            content: 'import x from "./client";\nexport const payments = true;',
          },
        ],
      },
      {
        queues: [
          {
            agent: "tpAgent",
            queue: [tpCandidate("c_trace", "tp_trace")],
            budgetTokens: 100_000,
            maxModelCalls: 1,
          },
        ],
        droppedCandidates: [],
      },
      [tpCandidate("c_trace", "tp_trace")],
      {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test",
        toolLoopMaxRounds: 1,
      },
    );
    expect(out.usageSummary?.agenticTrace).toBeDefined();
    expect(out.usageSummary?.agenticTrace?.length).toBe(1);
    expect(out.usageSummary?.agenticTrace?.[0]?.toolCalls.length).toBeGreaterThan(0);
  });

  it("deduplicates repeated search hits and prefers unseen files", async () => {
    inferSpy.mockResolvedValue({ proposals: [] });
    const components: DetectedComponent[] = [
      {
        id: "tp_search_dedupe",
        name: "Supabase",
        type: "third_party",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [{ filePath: "src/a.ts", startLine: 1, endLine: 1 }],
        properties: { vendor: null, section_id: "src" },
      },
    ];

    const out = await generateAgenticProposals(
      {
        components,
        dataFlows: [],
        files: [
          {
            path: "src/a.ts",
            name: "a.ts",
            language: "typescript",
            size: 200,
            content:
              "const one = 'supabase';\nconst two = 'supabase';\nconst three = 'supabase';\n",
          },
          {
            path: "src/b.ts",
            name: "b.ts",
            language: "typescript",
            size: 120,
            content: "const other = 'supabase';\n",
          },
        ],
      },
      {
        queues: [
          {
            agent: "tpAgent",
            queue: [tpCandidate("c_search_dedupe", "tp_search_dedupe")],
            budgetTokens: 100_000,
            maxModelCalls: 1,
          },
        ],
        droppedCandidates: [],
      },
      [tpCandidate("c_search_dedupe", "tp_search_dedupe")],
      {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test",
        toolLoopMaxRounds: 1,
      },
    );

    const trace = out.usageSummary?.agenticTrace?.[0];
    expect(trace).toBeDefined();
    const searchCall = trace?.toolCalls.find((step) => step.action === "search_text");
    expect(searchCall).toBeDefined();
    const touched = searchCall?.filesTouched ?? [];
    expect(new Set(touched).size).toBe(touched.length);
    expect(touched).toContain("src/b.ts");
  });
});
