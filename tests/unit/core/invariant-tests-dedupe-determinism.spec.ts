import path from "path";

import { buildDiagramGraphFromScanResult } from "../../../src/core/pipeline/graph-mapping";
import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";
import { dedupeDataFlows } from "../../../src/data-flow/dedupe";

import type { DetectedDataFlow } from "../../../src/core/types/data-flow";

function shuffleDeterministic<T>(arr: T[], mode: 1 | 2): T[] {
  // Avoid randomness to keep the test stable across runs.
  if (mode === 1) return [...arr].reverse();
  // mode 2: rotate by 1
  if (arr.length <= 1) return arr;
  return [arr[arr.length - 1]!, ...arr.slice(0, -1)];
}

describe("invariant-tests - determinism", () => {
  it("scan() twice produces identical graph outputs", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );

    const config = createDefaultScanConfiguration({ enableAiInference: false,
      deepAnalysis: false,
    });

    const { scanResult: scanResult1 } = await scan(fixturesRoot, config);
    const { scanResult: scanResult2 } = await scan(fixturesRoot, config);

    const graph1 = buildDiagramGraphFromScanResult(scanResult1);
    const graph2 = buildDiagramGraphFromScanResult(scanResult2);

    expect(graph1).toEqual(graph2);
  });

  it("dedupeDataFlows output is order-independent", () => {
    const baseFlows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "app",
        targetComponentId: "db",
        type: "database_query",
        confidence: 0.7,
        sourceLocation: { filePath: "src/db.ts", startLine: 20, endLine: 21 },
      },
      {
        id: "flow_2",
        sourceComponentId: "app",
        targetComponentId: "db",
        type: "database_query",
        confidence: 0.9,
        sourceLocation: { filePath: "src/db.ts", startLine: 10, endLine: 11 },
      },
      {
        id: "flow_3",
        sourceComponentId: "app",
        targetComponentId: "db2",
        type: "database_query",
        confidence: 0.8,
        sourceLocation: { filePath: "src/db2.ts", startLine: 5, endLine: 6 },
      },
    ];

    const dedupedA = dedupeDataFlows(baseFlows);
    const dedupedB = dedupeDataFlows(shuffleDeterministic(baseFlows, 1));
    const dedupedC = dedupeDataFlows(shuffleDeterministic(baseFlows, 2));

    expect(dedupedA).toEqual(dedupedB);
    expect(dedupedA).toEqual(dedupedC);
  });
});

