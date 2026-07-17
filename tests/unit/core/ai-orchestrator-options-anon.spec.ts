import { buildAgentOrchestratorOptions } from "../../../src/core/pipeline/ai-orchestrator-options";
import type { ScanConfiguration } from "../../../src/core/types";

function baseConfig(overrides: Partial<ScanConfiguration> = {}): ScanConfiguration {
  return {
    enableAPIDetection: true,
    enableDatabaseDetection: true,
    enableDataFlowDetection: true,
    minimumConfidence: 0.5,
    enableAiInference: true,
    ...overrides,
  };
}

describe("buildAgentOrchestratorOptions platform anon", () => {
  it("wires platformProxy with anon session token as bearer", () => {
    const options = buildAgentOrchestratorOptions(
      baseConfig({
        anonSessionToken: "dp_anon_session_token",
        cliQuotaJobId: "job-1",
        platformApiBaseUrl: "http://localhost:3000",
      }),
      { llmEnabled: true, skipStructuralHeuristics: false },
    );

    expect(options.platformProxy).toEqual({
      apiBaseUrl: "http://localhost:3000",
      workspaceApiKey: "dp_anon_session_token",
      jobId: "job-1",
    });
    expect(options.apiKey).toBeUndefined();
    expect(options.providerConcurrency).toBe(1);
  });
});
