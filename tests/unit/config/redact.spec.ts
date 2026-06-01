import { redactScanConfigurationForDisplay } from "../../../src/config/redact";
import { createDefaultScanConfiguration } from "../../../src/core/pipeline/orchestrator";

describe("redactScanConfigurationForDisplay", () => {
  it("redacts aiApiKey when present", () => {
    const config = createDefaultScanConfiguration({
      aiApiKey: "sk-secret-key-12345",
    });
    const redacted = redactScanConfigurationForDisplay(config);
    expect(redacted.aiApiKey).toBe("<redacted>");
    expect(JSON.stringify(redacted)).not.toContain("sk-secret-key-12345");
  });

  it("leaves config unchanged when aiApiKey is absent", () => {
    const config = createDefaultScanConfiguration();
    const redacted = redactScanConfigurationForDisplay(config);
    expect(redacted.aiApiKey).toBeUndefined();
  });
});
