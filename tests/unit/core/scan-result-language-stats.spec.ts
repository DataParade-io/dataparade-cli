import type { ScanConfiguration } from "../../../src/core/types";
import { createDefaultScanConfiguration } from "../../../src/core/pipeline/orchestrator";
import { runScanPipeline } from "../../../src/core/pipeline/scan-pipeline";

describe("ScanResult.languageStats for Python", () => {
  it("populates languageStats entry for Python files", async () => {
    const rootPath = `${__dirname}/../../fixtures/python-parser-basic`;
    const config: ScanConfiguration = createDefaultScanConfiguration({ enableAiInference: false });

    const { scanResult } = await runScanPipeline(rootPath, config);

    expect(scanResult.languageStats).toBeDefined();
    const pythonStats = scanResult.languageStats?.find(
      (entry) => entry.language === "python",
    );

    expect(pythonStats).toBeDefined();
    expect(pythonStats?.filesParsed).toBeGreaterThanOrEqual(1);
    expect(pythonStats?.functionsIndexed).toBeGreaterThanOrEqual(1);
  });
});

