import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../../src/core/pipeline/orchestrator";
import { scoreLayer } from "../../score";
import type { LayerScoreResult } from "../../types";
import {
  buildScannedFileCoverage,
  componentsToFindings,
} from "./adapter";
import {
  COMPONENT_EXHAUSTIVE_SCOPES,
  COMPONENT_FIXTURE_ROOTS,
  COMPONENT_GROUND_TRUTH,
} from "./cases";

const fixturesRoot = path.join(__dirname, "..", "..", "..", "fixtures");

function metricValues(result: LayerScoreResult): number[] {
  return [
    result.recall,
    result.labelAccuracy,
    result.correctLabelRecall,
    result.precision,
    result.negativeCasePassRate,
  ].filter((value): value is number => value !== null);
}

describe("component layer eval", () => {
  it("scores committed fixtures against component ground truth", async () => {
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const results: LayerScoreResult[] = [];

    for (const fixtureRoot of COMPONENT_FIXTURE_ROOTS) {
      const rootPath = path.join(fixturesRoot, fixtureRoot);
      const { scanResult, files } = await scan(rootPath, config);

      const findings = componentsToFindings(scanResult.components);
      const filePaths = files.map((file) => file.path);
      const scannedFiles = buildScannedFileCoverage(filePaths, filePaths);
      const groundTruth = COMPONENT_GROUND_TRUTH.filter(
        (caseEntry) => caseEntry.scopeId === fixtureRoot,
      );
      const exhaustiveScopes =
        fixtureRoot === "typescript-basic"
          ? COMPONENT_EXHAUSTIVE_SCOPES
          : [];

      results.push(
        scoreLayer({
          findings,
          groundTruth,
          exhaustiveScopes,
          scannedFiles,
        }),
      );
    }

    for (const result of results) {
      expect(typeof result.unreadCount).toBe("number");
      expect(result.counts).toEqual(
        expect.objectContaining({
          TP: expect.any(Number),
          FP: expect.any(Number),
          FN: expect.any(Number),
          TN: expect.any(Number),
          matchedPositives: expect.any(Number),
          labelMatches: expect.any(Number),
          evaluablePositives: expect.any(Number),
          negativeCases: expect.any(Number),
          negativePasses: expect.any(Number),
        }),
      );

      for (const value of metricValues(result)) {
        expect(Number.isNaN(value)).toBe(false);
      }

      for (const metric of [
        result.recall,
        result.labelAccuracy,
        result.correctLabelRecall,
        result.precision,
        result.negativeCasePassRate,
      ]) {
        expect(metric === null || typeof metric === "number").toBe(true);
      }
    }

    expect(results.some((result) => (result.recall ?? 0) > 0)).toBe(true);
    expect(
      results.some((result) => result.negativeCasePassRate !== null),
    ).toBe(true);

    expect(results[0].counts).toMatchSnapshot("typescript-basic-counts");
  });
});
