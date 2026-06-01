import { isScanAiDebugEnabled } from "../../../src/config/scan-env";

describe("isScanAiDebugEnabled", () => {
  it("accepts SCAN_AI_DEBUG", () => {
    expect(isScanAiDebugEnabled({ SCAN_AI_DEBUG: "true" })).toBe(true);
  });

  it("ignores legacy DATAPARADE_AI_DEBUG", () => {
    expect(isScanAiDebugEnabled({ DATAPARADE_AI_DEBUG: "1" })).toBe(false);
  });

  it("uses SCAN_AI_DEBUG only when legacy is also present", () => {
    expect(
      isScanAiDebugEnabled({
        SCAN_AI_DEBUG: "false",
        DATAPARADE_AI_DEBUG: "true",
      }),
    ).toBe(false);
  });
});
