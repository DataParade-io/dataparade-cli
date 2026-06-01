import { validateAiInferenceCredentials, resolveAiMode } from "../../../src/config/validate-scan-ai";
import type { ScanConfiguration } from "../../../src/core/types";

function baseConfig(overrides: Partial<ScanConfiguration> = {}): ScanConfiguration {
  return {
    enableAPIDetection: true,
    enableDatabaseDetection: true,
    enableDataFlowDetection: true,
    minimumConfidence: 0.5,
    ...overrides,
  };
}

describe("validate-scan-ai", () => {
  it("requires BYOK trio or workspace key when AI inference is on", () => {
    const errors = validateAiInferenceCredentials(
      baseConfig({ enableAiInference: true }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("accepts full BYOK trio", () => {
    const errors = validateAiInferenceCredentials(
      baseConfig({
        enableAiInference: true,
        aiProvider: "openai",
        aiModel: "gpt-4o-mini",
        aiApiKey: "sk-test",
      }),
    );
    expect(errors).toEqual([]);
    expect(resolveAiMode(baseConfig({
      enableAiInference: true,
      aiProvider: "openai",
      aiModel: "gpt-4o-mini",
      aiApiKey: "sk-test",
    }))).toBe("byok");
  });

  it("accepts workspace key with job id for platform mode", () => {
    const config = baseConfig({
      enableAiInference: true,
      workspaceApiKey: "dp_live_abc",
      cliQuotaJobId: "job-1",
    });
    expect(validateAiInferenceCredentials(config)).toEqual([]);
    expect(resolveAiMode(config)).toBe("platform");
  });

  it("allows workspace key with AI disabled", () => {
    const errors = validateAiInferenceCredentials(
      baseConfig({
        enableAiInference: false,
        workspaceApiKey: "dp_live_abc",
      }),
    );
    expect(errors).toEqual([]);
    expect(
      resolveAiMode(
        baseConfig({
          enableAiInference: false,
          workspaceApiKey: "dp_live_abc",
        }),
      ),
    ).toBe("none");
  });
});
