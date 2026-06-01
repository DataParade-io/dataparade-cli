import fs from "fs";
import os from "os";
import path from "path";

import { run } from "../../../src/cli";
import { validateDataflowJson } from "../../../src/core/schema/dataflow-wrapper.schema";

describe("cli scan command - DP-P0-CLI-402 integration", () => {
  it(
    "writes a valid dataflow.json wrapper to the output path",
    async () => {
      const fixturesRoot = path.join(
        __dirname,
        "..",
        "..",
        "fixtures",
        "typescript-basic",
      );

      const outputPath = path.join(
        os.tmpdir(),
        `dataparade-scan-${Date.now()}.json`,
      );

      await run(["node", "cli", "scan", fixturesRoot, "--output", outputPath]);

      const contents = fs.readFileSync(outputPath, "utf8");
      const parsed = JSON.parse(contents);
      const validation = validateDataflowJson(parsed);

      expect(validation.ok).toBe(true);
      if (!validation.ok) return;

      expect(validation.value.graph.nodes.length).toBeGreaterThan(0);
      expect(validation.value.graph.edges.length).toBeGreaterThan(0);

      fs.unlinkSync(outputPath);
    },
    15000,
  );
});

