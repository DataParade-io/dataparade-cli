import fs from "fs";
import path from "path";

import { createDefaultScanConfiguration, scan } from "../../../src/core/pipeline/orchestrator";
import { buildDataflowWrapper } from "../../../src/output/json";
import { buildDiagramGraphFromScanResult } from "../../../src/core/pipeline/graph-mapping";

describe("terraform JSON overlay in scan pipeline", () => {
  it("merges extra plan resources and sets terraformScanSummary + metadata.terraform", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "terraform-basic",
    );
    const jsonFixture = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "terraform-show-extra-bucket.json",
    );

    const overlayInRoot = path.join(fixturesRoot, "show-overlay.json");
    fs.copyFileSync(jsonFixture, overlayInRoot);
    try {
      const config = createDefaultScanConfiguration({
        terraformJsonPath: "show-overlay.json",
      });

      const { scanResult } = await scan(fixturesRoot, config);

      expect(scanResult.terraformScanSummary).toBeDefined();
      expect(scanResult.terraformScanSummary?.mode).toBe("json_overlay");
      expect(scanResult.terraformScanSummary?.jsonFindingsMerged).toBeGreaterThanOrEqual(1);

      const extraBucket = scanResult.components.some(
        (c) =>
          c.name.includes("only_in_plan") ||
          (c.properties?.terraform_address as string | undefined)?.includes(
            "only_in_plan",
          ),
      );
      expect(extraBucket).toBe(true);

      const graph = buildDiagramGraphFromScanResult(scanResult);
      const wrapper = buildDataflowWrapper(scanResult, graph);
      expect(
        (wrapper.metadata as Record<string, unknown> | undefined)?.terraform,
      ).toEqual(scanResult.terraformScanSummary);
    } finally {
      fs.unlinkSync(overlayInRoot);
    }
  });
});
