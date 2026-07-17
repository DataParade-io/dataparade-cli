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

  it("accepts anonymous session token with job id for platform mode", () => {
    const config = baseConfig({
      enableAiInference: true,
      anonSessionToken: "dp_anon_abc",
      cliQuotaJobId: "job-1",
    });
    expect(validateAiInferenceCredentials(config)).toEqual([]);
    expect(resolveAiMode(config)).toBe("platform");
  });

  it("rejects workspace key and anonymous session together", () => {
    const errors = validateAiInferenceCredentials(
      baseConfig({
        enableAiInference: true,
        workspaceApiKey: "dp_live_abc",
        anonSessionToken: "dp_anon_abc",
        cliQuotaJobId: "job-1",
      }),
    );
    expect(errors.some((e) => e.includes("not both"))).toBe(true);
  });

  it("requires job id for anonymous platform mode", () => {
    const errors = validateAiInferenceCredentials(
      baseConfig({
        enableAiInference: true,
        anonSessionToken: "dp_anon_abc",
      }),
    );
    expect(errors.some((e) => e.includes("job id"))).toBe(true);
  });

  it("accepts hosted worker infer proxy without BYOK or workspace key", () => {
    const config = baseConfig({
      enableAiInference: true,
      hostedInferProxyUrl: "http://127.0.0.1:4567/infer",
    });
    expect(validateAiInferenceCredentials(config)).toEqual([]);
    expect(resolveAiMode(config)).toBe("hosted_worker");
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
