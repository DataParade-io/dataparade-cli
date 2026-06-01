import { validateScanConfiguration } from "../../src/core/schema/scan-config.schema";
describe("scanConfigurationSchema", () => {
  it("accepts a minimal valid configuration", () => {
    const input = {
      enableAPIDetection: true,
      enableDatabaseDetection: true,
      enableDataFlowDetection: true,
      minimumConfidence: 0.5,
    };

    const result = validateScanConfiguration(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.minimumConfidence).toBe(0.5);
    }
  });

  it("rejects invalid minimumConfidence and missing flags", () => {
    const input = {
      enableAPIDetection: "true",
      enableDatabaseDetection: true,
      enableDataFlowDetection: true,
      minimumConfidence: 2,
    } as unknown;

    const result = validateScanConfiguration(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const message = result.errors.join(" | ");
      expect(message).toMatch(/enableAPIDetection/);
      expect(message).toMatch(/minimumConfidence/);
    }
  });

  it("accepts python in languages", () => {
    const input = {
      enableAPIDetection: true,
      enableDatabaseDetection: true,
      enableDataFlowDetection: true,
      minimumConfidence: 0.5,
      languages: ["python"],
    };

    const result = validateScanConfiguration(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.languages).toEqual(["python"]);
    }
  });

  it("accepts openrouter as aiProvider", () => {
    const input = {
      enableAPIDetection: true,
      enableDatabaseDetection: true,
      enableDataFlowDetection: true,
      minimumConfidence: 0.5,
      aiProvider: "openrouter",
      aiModel: "openai/gpt-4o-mini",
    };

    const result = validateScanConfiguration(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.aiProvider).toBe("openrouter");
    }
  });

  it("accepts positive aiProviderConcurrency", () => {
    const input = {
      enableAPIDetection: true,
      enableDatabaseDetection: true,
      enableDataFlowDetection: true,
      minimumConfidence: 0.5,
      aiProviderConcurrency: 3,
    };

    const result = validateScanConfiguration(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.aiProviderConcurrency).toBe(3);
    }
  });

  it("accepts terraformJsonPath and terraformPlanPath", () => {
    const input = {
      enableAPIDetection: true,
      enableDatabaseDetection: true,
      enableDataFlowDetection: true,
      minimumConfidence: 0.5,
      terraformJsonPath: "./show.json",
      terraformPlanPath: "tfplan",
    };

    const result = validateScanConfiguration(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.terraformJsonPath).toBe("./show.json");
      expect(result.value.terraformPlanPath).toBe("tfplan");
    }
  });

  it("accepts terraformStackSectionPathDepth when positive integer", () => {
    const input = {
      enableAPIDetection: true,
      enableDatabaseDetection: true,
      enableDataFlowDetection: true,
      minimumConfidence: 0.5,
      terraformStackSectionPathDepth: 2,
    };

    const result = validateScanConfiguration(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.terraformStackSectionPathDepth).toBe(2);
    }
  });

  it("rejects non-positive terraformStackSectionPathDepth", () => {
    const input = {
      enableAPIDetection: true,
      enableDatabaseDetection: true,
      enableDataFlowDetection: true,
      minimumConfidence: 0.5,
      terraformStackSectionPathDepth: 0,
    };

    const result = validateScanConfiguration(input);
    expect(result.ok).toBe(false);
  });

  it("accepts workspace key + preflight job for platform AI", () => {
    const input = {
      enableAPIDetection: true,
      enableDatabaseDetection: true,
      enableDataFlowDetection: true,
      minimumConfidence: 0.5,
      enableAiInference: true,
      workspaceApiKey: "dp_live_1234567890abcdef",
      cliQuotaJobId: "8fb246ac-9b92-4809-a901-602615c97eda",
      aiMode: "platform",
    };

    const result = validateScanConfiguration(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.workspaceApiKey).toBe("dp_live_1234567890abcdef");
      expect(result.value.cliQuotaJobId).toBe(
        "8fb246ac-9b92-4809-a901-602615c97eda",
      );
    }
  });
});

