jest.mock("../../../src/config/resolve", () => ({
  resolveScanConfiguration: jest.fn(() => ({ overrides: {}, warnings: [] })),
}));

jest.mock("../../../src/core/pipeline/scan-pipeline", () => ({
  runScanPipeline: jest.fn(async () => ({
    scanResult: {
      components: [],
      dataFlows: [],
      filesScanned: 0,
      filesSkipped: 0,
      totalLines: 0,
      scanDurationMs: 0,
      warnings: [],
      errors: [],
      languageStats: undefined,
    },
  })),
}));

jest.mock("../../../src/core/pipeline/orchestrator", () => ({
  createDefaultScanConfiguration: jest.fn((overrides = {}) => ({
    enableAPIDetection: true,
    enableDatabaseDetection: true,
    enableDataFlowDetection: true,
    minimumConfidence: 0.5,
    ...overrides,
    enableAiInference: overrides.enableAiInference ?? false,
  })),
}));

jest.mock("../../../src/core/pipeline/graph-mapping", () => ({
  buildDiagramGraphFromScanResult: jest.fn(() => ({
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  })),
}));

jest.mock("../../../src/output/json", () => ({
  writeDataflowJson: jest.fn(() => {}),
  buildDataflowWrapper: jest.fn(() => ({
    schemaVersion: "1.0",
    graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    metadata: {
      componentsCount: 0,
      dataFlowsCount: 0,
      filesScanned: 0,
      scanDurationMs: 0,
    },
  })),
}));

describe("cli scan command ai flags", () => {
  let consoleLogSpy: jest.SpyInstance;
  let prevSkipAutoUpload: string | undefined;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    prevSkipAutoUpload = process.env.DATAPARADE_SKIP_AUTO_UPLOAD;
    process.env.DATAPARADE_SKIP_AUTO_UPLOAD = "true";
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    if (prevSkipAutoUpload === undefined) {
      delete process.env.DATAPARADE_SKIP_AUTO_UPLOAD;
    } else {
      process.env.DATAPARADE_SKIP_AUTO_UPLOAD = prevSkipAutoUpload;
    }
  });

  it("normalizes --ai-inference-scope third-party-only to third_party_only", async () => {
    const { run } = require("../../../src/cli") as typeof import("../../../src/cli");
    const configResolve = require("../../../src/config/resolve");

    await run([
      "node",
      "cli",
      "scan",
      ".",
      "--ai-inference-scope",
      "third-party-only",
    ]);

    const firstCall = configResolve.resolveScanConfiguration.mock.calls[0] as [
      { flags: { aiInferenceScope?: string; aiVerbose?: boolean } },
    ];
    expect(firstCall[0].flags.aiInferenceScope).toBe("third_party_only");
    expect(firstCall[0].flags.aiVerbose).toBeUndefined();
  });

  it("passes --ai-verbose through to config resolution", async () => {
    const { run } = require("../../../src/cli") as typeof import("../../../src/cli");
    const configResolve = require("../../../src/config/resolve");

    await run(["node", "cli", "scan", ".", "--ai-verbose"]);

    const lastCall = configResolve.resolveScanConfiguration.mock.calls.at(-1) as [
      { flags: { aiVerbose?: boolean } },
    ];
    expect(lastCall[0].flags.aiVerbose).toBe(true);
  });

  it("prints all proposal property changes one per line without truncation", async () => {
    const { run } = require("../../../src/cli") as typeof import("../../../src/cli");
    const scanPipeline = require("../../../src/core/pipeline/scan-pipeline");

    scanPipeline.runScanPipeline.mockResolvedValueOnce({
      scanResult: {
        components: [],
        dataFlows: [],
        filesScanned: 0,
        filesSkipped: 0,
        totalLines: 0,
        scanDurationMs: 0,
        warnings: [],
        errors: [],
        languageStats: undefined,
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
          inputTokens: 10,
          outputTokens: 10,
          totalTokens: 20,
          estimatedCostUsd: 0.001,
          aiProvider: "openai",
          aiModel: "gpt-4o-mini",
        },
        aiInferenceProposalDetails: [
          {
            id: "provider_1",
            source: "provider",
            status: "applied",
            kind: "component_patch",
            candidateType: "node_property",
            agent: "propertyAgent",
            provider: "openai",
            model: "gpt-4o-mini",
            confidence: 0.85,
            confidenceBand: "high",
            targetComponentId: "cmp_1",
            evidence: [
              {
                filePath: "file.ts",
                startLine: 1,
                endLine: 1,
                reason: "reason",
              },
            ],
            propertyChanges: [
              { key: "inference_status", from: undefined, to: "needs_review" },
              { key: "access_controls_for_delivery", from: null, to: null },
              { key: "api_versioning_strategy", from: null, to: "none" },
              { key: "analytics_sdks", from: [], to: null },
              { key: "cloud_services_used", from: [], to: ["aws"] },
              { key: "api_endpoint", from: null, to: "/api/ai-completion" },
              { key: "api_type", from: "rest", to: "rest" },
              { key: "api_key_management", from: null, to: null },
            ],
          },
        ],
      },
    });

    await run(["node", "cli", "scan", ".", "--ai-verbose"]);

    const output = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .filter((line): line is string => typeof line === "string");
    const changesLines = output.filter((line) => line.includes("[scan]       changes="));
    const allChangesText = changesLines.join("\n");

    expect(changesLines.length).toBe(8);
    expect(allChangesText).toContain('cloud_services_used: [] -> ["aws"]');
    expect(allChangesText).toContain('api_endpoint: null -> "/api/ai-completion"');
    expect(allChangesText).toContain('inference_status: undefined -> "needs_review"');
    expect(allChangesText).toContain("access_controls_for_delivery: null -> null");
    expect(allChangesText).toContain('api_versioning_strategy: null -> "none"');
    expect(output.some((line) => line.includes("changes=... +"))).toBe(false);
  });


});
