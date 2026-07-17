import fs from "fs";
import os from "os";
import path from "path";

import { run } from "../../../src/cli";
import { validateDataflowJson } from "../../../src/core/schema/dataflow-wrapper.schema";

describe("cli scan command - DP-P0-CLI-404 e2e TypeScript sample", () => {
  it(
    "scans the e2e-ts-sample fixture and produces a valid dataflow.json with database and third-party components and flows",
    async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "e2e-ts-sample",
    );

    const outputPath = path.join(
      os.tmpdir(),
      `dataparade-scan-e2e-ts-sample-${Date.now()}.json`,
    );

    await run([
      "node",
      "cli",
      "scan",
      fixturesRoot,
      "--output",
      outputPath,
      "--no-ai-inference",
      "--skip-auto-upload",
    ]);

    const contents = fs.readFileSync(outputPath, "utf8");
    const parsed = JSON.parse(contents);
    const validation = validateDataflowJson(parsed);

    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    const { graph } = validation.value;

    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.edges)).toBe(true);
    expect(graph.nodes.length).toBeGreaterThan(1);
    expect(graph.edges.length).toBeGreaterThan(0);

    const dbNode = graph.nodes.find((node) => {
      const data = node.data as any;
      return (
        data &&
        data.componentType === "asset" &&
        data.componentSubType === "database"
      );
    });

    const thirdPartyNode = graph.nodes.find((node) => {
      const data = node.data as any;
      return data && data.componentType === "third_party";
    });

    expect(dbNode).toBeDefined();
    expect(thirdPartyNode).toBeDefined();

    fs.unlinkSync(outputPath);
  },
    15000,
  );
});

