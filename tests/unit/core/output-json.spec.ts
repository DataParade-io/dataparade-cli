import fs from "fs";
import os from "os";
import path from "path";

import { buildDiagramGraphFromScanResult } from "../../../src/core/pipeline/graph-mapping";
import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";
import { runScanPipeline } from "../../../src/core/pipeline/scan-pipeline";
import { validateDataflowJson } from "../../../src/core/schema/dataflow-wrapper.schema";
import { buildDataflowWrapper, writeDataflowJson } from "../../../src/output/json";

describe("output/json - DP-P0-CLI-403", () => {
  it("builds and writes a validated dataflow.json wrapper for a real ScanResult", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );

    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult } = await runScanPipeline(fixturesRoot, config);

    const graph = buildDiagramGraphFromScanResult(scanResult);

    const wrapper = buildDataflowWrapper(scanResult, graph, {
      projectName: "typescript-basic",
    });

    const validation = validateDataflowJson(wrapper);
    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      return;
    }

    expect(validation.value.metadata?.componentsCount).toBe(
      scanResult.components.length,
    );
    expect(validation.value.metadata?.dataFlowsCount).toBe(
      scanResult.dataFlows.length,
    );
    expect(validation.value.metadata?.filesScanned).toBe(
      scanResult.filesScanned,
    );
    expect(validation.value.metadata?.scanDurationMs).toBe(
      scanResult.scanDurationMs,
    );
    expect(validation.value.metadata?.projectName).toBe("typescript-basic");

    const outputPath = path.join(
      os.tmpdir(),
      `dataparade-dataflow-${Date.now()}.json`,
    );

    writeDataflowJson({
      scanResult,
      graph,
      outputPath,
    });

    const contents = fs.readFileSync(outputPath, "utf8");
    const parsed = JSON.parse(contents);
    const fileValidation = validateDataflowJson(parsed);

    expect(fileValidation.ok).toBe(true);

    fs.unlinkSync(outputPath);
  });

  it("throws and does not write a file when validation fails", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );

    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult } = await runScanPipeline(fixturesRoot, config);

    const graph = buildDiagramGraphFromScanResult(scanResult);

    // Create an intentionally invalid graph by clearing the first node id so
    // that validation fails when writing the wrapper.
    const invalidGraph = {
      ...graph,
      nodes: graph.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              id: "",
            }
          : node,
      ),
    } as any;

    const outputPath = path.join(
      os.tmpdir(),
      `dataparade-dataflow-invalid-${Date.now()}.json`,
    );

    expect(() =>
      writeDataflowJson({
        scanResult,
        graph: invalidGraph,
        outputPath,
      }),
    ).toThrow(/Invalid dataflow\.json wrapper/);

    expect(fs.existsSync(outputPath)).toBe(false);
  });
});

