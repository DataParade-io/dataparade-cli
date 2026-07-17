import fs from "fs/promises";
import path from "path";
import os from "os";

import { createDefaultScanConfiguration, scan } from "../../../src/core/pipeline/orchestrator";

// Keep the test focused on manifest-scanning budgets.
jest.mock("../../../src/analyzers/registry", () => ({
  runAnalyzers: jest.fn(() => []),
}));

function tempRootForTest(): string {
  // Ensure the temp dir is inside the repo workspace (important for sandboxed CI).
  return path.join(
    __dirname,
    "..",
    "..",
    ".tmp",
    `manifest-budgets-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
}

async function createManyTypeScriptManifests(
  rootDir: string,
  count: number,
): Promise<void> {
  const base = path.join(rootDir, "manifests_ts");
  await fs.mkdir(base, { recursive: true });

  // Ensure express_route evidence can be inferred if budgets allow scanning.
  const pkgJson = JSON.stringify({
    dependencies: { next: "1.0.0" },
  });

  for (let i = 0; i < count; i += 1) {
    const dir = path.join(base, `pkg_${i}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "package.json"), pkgJson, "utf8");
  }
}

async function createManyPythonManifests(
  rootDir: string,
  count: number,
): Promise<void> {
  const base = path.join(rootDir, "manifests_py");
  await fs.mkdir(base, { recursive: true });

  const requirements = "openai==1.0.0\nsentry-sdk==2.0.0\n";
  for (let i = 0; i < count; i += 1) {
    await fs.writeFile(
      path.join(base, `requirements_${i}.txt`),
      requirements,
      "utf8",
    );
  }
}

describe("dependency-manifest performance budgets (non-fatal)", () => {
  jest.setTimeout(30_000);

  it("stops manifest scanning when budgets are exceeded and still succeeds", async () => {
    const root = tempRootForTest();

    try {
      await fs.mkdir(root, { recursive: true });

      // Minimal code presence for section discovery.
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(path.join(root, "src", "index.ts"), "// empty\n", "utf8");

      // Create enough manifests to exceed default budgets (maxManifestFiles=500).
      await createManyTypeScriptManifests(root, 600);
      await createManyPythonManifests(root, 600);

      const config = createDefaultScanConfiguration({ enableAiInference: false,
        languages: ["typescript", "python"],
        enableDataFlowDetection: false,
        deepAnalysis: false,
      });

      const { scanResult } = await scan(root, config);

      expect(Array.isArray(scanResult.components)).toBe(true);
      expect(Array.isArray(scanResult.warnings)).toBe(true);

      // We expect at least one budget-related warning from either TS or Python.
      const budgetWarns = scanResult.warnings.filter((w) =>
        /manifest scan budget exceeded/i.test(w),
      );
      expect(budgetWarns.length).toBeGreaterThanOrEqual(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });
});

