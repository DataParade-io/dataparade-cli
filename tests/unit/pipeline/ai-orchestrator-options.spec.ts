import { buildAgentOrchestratorOptions } from "../../../src/core/pipeline/ai-orchestrator-options";
import type { ScanConfiguration } from "../../../src/core/types";

describe("buildAgentOrchestratorOptions", () => {
  it("forces providerConcurrency=1 for platform-billed scans", () => {
    const config = {
      enableAiInference: true,
      workspaceApiKey: "dp_test_key",
      cliQuotaJobId: "job-1",
      aiProviderConcurrency: 4,
    } as ScanConfiguration;

    const options = buildAgentOrchestratorOptions(config, {
      llmEnabled: true,
      skipStructuralHeuristics: false,
    });

    expect(options.platformProxy).toBeDefined();
    expect(options.providerConcurrency).toBe(1);
  });
});
