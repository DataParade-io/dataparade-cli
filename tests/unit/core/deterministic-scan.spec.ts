import fs from "fs";
import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";
import { runScanPipeline } from "../../../src/core/pipeline/scan-pipeline";

const DETERMINISTIC_SCAN_SOURCE = fs.readFileSync(
  path.join(__dirname, "../../../src/core/pipeline/deterministic-scan.ts"),
  "utf8",
);

const ORCHESTRATOR_SOURCE = fs.readFileSync(
  path.join(__dirname, "../../../src/core/pipeline/orchestrator.ts"),
  "utf8",
);

describe("core/pipeline/deterministic-scan - KDATAP-439908", () => {
  it("does not statically import ai-enrichment or tracing modules", () => {
    expect(DETERMINISTIC_SCAN_SOURCE).not.toMatch(/from ["'].*ai-enrichment/);
    expect(DETERMINISTIC_SCAN_SOURCE).not.toMatch(/from ["'].*tracing/);
    expect(ORCHESTRATOR_SOURCE).not.toMatch(/from ["'].*ai-enrichment/);
    expect(ORCHESTRATOR_SOURCE).not.toMatch(/from ["'].*tracing/);
  });

  it("matches the non-AI pipeline for the typescript-basic fixture", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );

    const config = createDefaultScanConfiguration({ enableAiInference: false });

    const deterministic = await scan(fixturesRoot, config);
    const fullPipeline = await runScanPipeline(fixturesRoot, config);

    const componentKey = (c: {
      id: string;
      type: string;
      name: string;
      subType?: string;
      properties?: Record<string, unknown>;
    }) =>
      [
        c.id,
        c.type,
        c.name,
        c.subType ?? "",
        c.properties?.subType ?? "",
      ].join(":");

    const deterministicComponents = deterministic.scanResult.components
      .map(componentKey)
      .sort();
    const fullComponents = fullPipeline.scanResult.components
      .map(componentKey)
      .sort();

    expect(deterministicComponents).toEqual(fullComponents);

    const flowKey = (f: {
      id: string;
      sourceComponentId: string;
      targetComponentId: string;
      type: string;
    }) => [f.id, f.sourceComponentId, f.targetComponentId, f.type].join(":");

    const deterministicFlows = deterministic.scanResult.dataFlows
      .map(flowKey)
      .sort();
    const fullFlows = fullPipeline.scanResult.dataFlows.map(flowKey).sort();

    expect(deterministicFlows).toEqual(fullFlows);
  });
});
