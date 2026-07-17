import type { DiagramGraphJsonSchema } from "../../../src/core/schema";
import { buildDiagramGraphFromScanResult } from "../../../src/core/pipeline/graph-mapping";
import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";

import path from "path";

function graphNodesContainCodeKey(graph: DiagramGraphJsonSchema): boolean {
  const visited = new Set<unknown>();

  const walk = (value: unknown): boolean => {
    if (value === null || value === undefined) return false;
    if (typeof value !== "object") return false;
    if (visited.has(value)) return false;
    visited.add(value);

    if (Array.isArray(value)) {
      for (const v of value) {
        if (walk(v)) return true;
      }
      return false;
    }

    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "code") return true;
      if (walk(v)) return true;
    }

    return false;
  };

  for (const node of graph.nodes) {
    if (node?.data && walk(node.data)) return true;
  }

  return false;
}

describe("output safety - no source code leakage (DP-P0-CLI-XXX)", () => {
  it("does not emit `code` under graph.nodes[].data", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );

    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult } = await scan(fixturesRoot, config);

    const graph = buildDiagramGraphFromScanResult(scanResult);
    expect(graphNodesContainCodeKey(graph)).toBe(false);
  });
});

