import type { ScanConfiguration } from "../../../src/core/types";
import { createDefaultScanConfiguration, scan } from "../../../src/core/pipeline/orchestrator";

describe("ScanResult.languageStats for Python", () => {
  it("populates languageStats entry for Python files", async () => {
    const rootPath = `${__dirname}/../../fixtures/python-parser-basic`;
    const config: ScanConfiguration = createDefaultScanConfiguration();

    const { scanResult } = await scan(rootPath, config);

    expect(scanResult.languageStats).toBeDefined();
    const pythonStats = scanResult.languageStats?.find(
      (entry) => entry.language === "python",
    );

    expect(pythonStats).toBeDefined();
    expect(pythonStats?.filesParsed).toBeGreaterThanOrEqual(1);
    expect(pythonStats?.functionsIndexed).toBeGreaterThanOrEqual(1);
  });
});

