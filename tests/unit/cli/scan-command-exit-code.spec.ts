import fs from "fs";
import os from "os";
import path from "path";

jest.mock("../../../src/core/pipeline/scan-pipeline", () => ({
  runScanPipeline: jest.fn(async () => ({
    scanResult: {
      components: [],
      dataFlows: [],
      filesScanned: 0,
      filesSkipped: 0,
      totalLines: 0,
      scanDurationMs: 0,
      warnings: [],
      errors: [],
      languageStats: undefined,
    },
  })),
}));

jest.mock("../../../src/core/pipeline/orchestrator", () => ({
  createDefaultScanConfiguration: jest.fn((overrides) => ({
    ...overrides,
    projectName: overrides?.projectName,
    excludePaths: overrides?.excludePaths,
    exclude: overrides?.exclude,
    minimumConfidence: overrides?.minimumConfidence ?? 0,
    enableAPIDetection: overrides?.enableAPIDetection ?? true,
    enableDatabaseDetection: overrides?.enableDatabaseDetection ?? true,
    enableDataFlowDetection:
      overrides?.enableDataFlowDetection ?? true,
    languages: overrides?.languages,
    deepAnalysis: overrides?.deepAnalysis ?? false,
  })),
}));

jest.mock("../../../src/core/pipeline/graph-mapping", () => ({
  buildDiagramGraphFromScanResult: jest.fn(() => ({
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  })),
}));

jest.mock("../../../src/output/json", () => ({
  writeDataflowJson: jest.fn(async () => {}),
  buildDataflowWrapper: jest.fn(() => ({
    schemaVersion: "1.0",
    graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    metadata: {
      componentsCount: 0,
      dataFlowsCount: 0,
      filesScanned: 0,
      scanDurationMs: 0,
    },
  })),
}));

describe("cli scan command - exit codes", () => {
  const fixturesRoot = path.join(
    __dirname,
    "..",
    "..",
    "fixtures",
    "typescript-basic",
  );

  function tmpOutputPath(): string {
    return path.join(os.tmpdir(), `dataparade-exit-${Date.now()}.json`);
  }

  let prevSkipAutoUpload: string | undefined;

  beforeEach(() => {
    prevSkipAutoUpload = process.env.DATAPARADE_SKIP_AUTO_UPLOAD;
    process.env.DATAPARADE_SKIP_AUTO_UPLOAD = "true";
  });

  afterEach(() => {
    process.exitCode = undefined;
    if (prevSkipAutoUpload === undefined) {
      delete process.env.DATAPARADE_SKIP_AUTO_UPLOAD;
    } else {
      process.env.DATAPARADE_SKIP_AUTO_UPLOAD = prevSkipAutoUpload;
    }
  });

  it("sets exitCode=1 when scanResult.errors is non-empty", async () => {
    const { run } = require("../../../src/cli") as typeof import("../../../src/cli");
    const scanPipeline = require("../../../src/core/pipeline/scan-pipeline");
    const graphMapping = require("../../../src/core/pipeline/graph-mapping");
    const outputJson = require("../../../src/output/json");

    // Reset before running.
    process.exitCode = undefined;

    scanPipeline.runScanPipeline.mockResolvedValueOnce({
      scanResult: {
        components: [],
        dataFlows: [],
        filesScanned: 0,
        filesSkipped: 0,
        totalLines: 0,
        scanDurationMs: 0,
        warnings: [],
        errors: ["mock-error"],
        languageStats: undefined,
      },
    });

    graphMapping.buildDiagramGraphFromScanResult.mockImplementationOnce(() => ({
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }));
    outputJson.writeDataflowJson.mockClear();

    await run([
      "node",
      "cli",
      "scan",
      fixturesRoot,
      "--output",
      tmpOutputPath(),
      "--no-ai-inference",
    ]);

    expect(process.exitCode).toBe(1);
    expect(outputJson.writeDataflowJson).toHaveBeenCalled();
  });

  it("sets exitCode=1 when diagram graph building fails", async () => {
    const { run } = require("../../../src/cli") as typeof import("../../../src/cli");
    const scanPipeline = require("../../../src/core/pipeline/scan-pipeline");
    const graphMapping = require("../../../src/core/pipeline/graph-mapping");
    const outputJson = require("../../../src/output/json");

    process.exitCode = undefined;

    scanPipeline.runScanPipeline.mockResolvedValueOnce({
      scanResult: {
        components: [],
        dataFlows: [],
        filesScanned: 0,
        filesSkipped: 0,
        totalLines: 0,
        scanDurationMs: 0,
        warnings: [],
        errors: [],
        languageStats: undefined,
      },
    });

    graphMapping.buildDiagramGraphFromScanResult.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    outputJson.writeDataflowJson.mockClear();

    const outputPath = tmpOutputPath();
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

    await run([
      "node",
      "cli",
      "scan",
      fixturesRoot,
      "--output",
      outputPath,
      "--no-ai-inference",
    ]);

    expect(process.exitCode).toBe(1);
    expect(outputJson.writeDataflowJson).not.toHaveBeenCalled();
    expect(fs.existsSync(outputPath)).toBe(false);
  });
});

