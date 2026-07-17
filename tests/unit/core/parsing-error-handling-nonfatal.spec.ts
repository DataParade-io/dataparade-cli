import fs from "fs/promises";
import path from "path";

import {
  buildDiagramGraphFromScanResult,
} from "../../../src/core/pipeline/graph-mapping";
import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";

function tempRootForTest(): string {
  return path.join(
    __dirname,
    "..",
    "..",
    ".tmp",
    `parsing-nonfatal-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
}

describe("parsing error handling - non-fatal", () => {
  it("completes scan with TS parse issues and Python null bytes", async () => {
    const root = tempRootForTest();

    try {
      await fs.mkdir(root, { recursive: true });

      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(path.join(root, "src", "index.ts"), "export {};\n", "utf8");

      // Intentionally invalid TS syntax to trigger TS parse diagnostics.
      await fs.writeFile(
        path.join(root, "src", "invalid.ts"),
        "export const broken = ;\n",
        "utf8",
      );

      // Python file with a literal null byte to trigger parser warning.
      // Use a Buffer to ensure the null byte is present in the file.
      await fs.writeFile(
        path.join(root, "main.py"),
        Buffer.from("import os\n\x00\n", "utf8"),
      );

      const config = createDefaultScanConfiguration({ enableAiInference: false,
        languages: ["typescript", "python"],
        enableDataFlowDetection: false,
      });

      const { scanResult } = await scan(root, config);

      expect(Array.isArray(scanResult.errors)).toBe(true);
      expect(scanResult.errors).toHaveLength(0);

      expect(scanResult.warnings.some((w) => /contains null bytes/i.test(w))).toBe(
        true,
      );

      // Ensure graph mapping can be built even when parsing issues exist.
      const graph = buildDiagramGraphFromScanResult(scanResult);
      expect(Array.isArray(graph.nodes)).toBe(true);
      expect(Array.isArray(graph.edges)).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });
});

