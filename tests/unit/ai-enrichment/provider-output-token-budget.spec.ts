import { clampStructuredJsonCompletionTokens } from "../../../src/ai-enrichment/providers/provider-output-token-budget";

describe("clampStructuredJsonCompletionTokens", () => {
  it("defaults to 8192 when undefined", () => {
    expect(clampStructuredJsonCompletionTokens(undefined)).toBe(8192);
  });

  it("floors small values to 4096", () => {
    expect(clampStructuredJsonCompletionTokens(256)).toBe(4096);
    expect(clampStructuredJsonCompletionTokens(4096)).toBe(4096);
  });

  it("caps at 16384", () => {
    expect(clampStructuredJsonCompletionTokens(100_000)).toBe(16_384);
  });
});
