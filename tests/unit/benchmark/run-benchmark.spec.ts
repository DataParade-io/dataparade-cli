import fs from "fs";
import os from "os";
import path from "path";

import type { FixtureScanResult } from "../../eval/types";
import {
  assertMaterialized,
  MaterializationMissingError,
  resolveMaterializedRepoPath,
  runBenchmarkRepo,
} from "../../benchmark/run-benchmark";
import { normalizeRepoRelativePath } from "../../benchmark/scan-repo";

const COMMIT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REPO_KEY = "test-repo";

function writeYaml(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function createBenchmarkFixture(root: string): void {
  const repoDir = path.join(root, "repos", REPO_KEY);
  writeYaml(
    path.join(repoDir, "manifest.yaml"),
    `repository: example/test-repo
commit: ${COMMIT}
license: LicenseRef-Test
scope:
  include:
    - app/
coverage:
  layers: [components]
  languages: [python]
  domains: [test]
selection_rationale: synthetic benchmark fixture
annotation_version: 1
`,
  );

  writeYaml(
    path.join(repoDir, "annotations", "components.yaml"),
    `annotations:
  - id: accepted-positive
    layer: components
    subject:
      key: asset:database
      name: Database
    evidence:
      file_path: app/models.py
      start_line: 4
      end_line: 6
    expected:
      status: positive
      labels: [database]
    rationale: accepted positive case
    provenance:
      proposed_by: test
      proposed_at: 2026-08-26
      review_state: accepted

  - id: proposed-positive
    layer: components
    subject:
      key: third_party:stripe
      name: Stripe
    evidence:
      file_path: app/payments.py
      start_line: 10
      end_line: 12
    expected:
      status: positive
      labels: [third_party]
    rationale: proposed case excluded by default
    provenance:
      proposed_by: test
      proposed_at: 2026-08-26
      review_state: proposed
`,
  );
}

function materializeRepo(root: string): string {
  const materializedPath = path.join(root, ".cache", "repos", `${REPO_KEY}@${COMMIT}`);
  fs.mkdirSync(materializedPath, { recursive: true });
  return materializedPath;
}

describe("benchmark run-benchmark", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "benchmark-run-"));
    createBenchmarkFixture(tempRoot);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  describe("resolveMaterializedRepoPath", () => {
    it("resolves cache path from manifest commit", () => {
      expect(resolveMaterializedRepoPath(REPO_KEY, tempRoot)).toBe(
        path.join(tempRoot, ".cache", "repos", `${REPO_KEY}@${COMMIT}`),
      );
    });
  });

  describe("assertMaterialized", () => {
    it("throws a clear error when materialization is missing", () => {
      const expectedPath = path.join(
        tempRoot,
        ".cache",
        "repos",
        `${REPO_KEY}@${COMMIT}`,
      );

      expect(() => assertMaterialized(REPO_KEY, tempRoot)).toThrow(
        MaterializationMissingError,
      );
      expect(() => assertMaterialized(REPO_KEY, tempRoot)).toThrow(
        `Benchmark repo '${REPO_KEY}' is not materialized at ${expectedPath}`,
      );
      expect(() => assertMaterialized(REPO_KEY, tempRoot)).toThrow(
        `pnpm run benchmark:materialize ${REPO_KEY}`,
      );
    });

    it("returns the materialized path when present", () => {
      const materializedPath = materializeRepo(tempRoot);
      expect(assertMaterialized(REPO_KEY, tempRoot)).toBe(materializedPath);
    });
  });

  describe("normalizeRepoRelativePath", () => {
    it("normalizes windows separators and leading ./ prefixes", () => {
      expect(normalizeRepoRelativePath(".\\app\\models.py")).toBe("app/models.py");
      expect(normalizeRepoRelativePath("./app/models.py")).toBe("app/models.py");
      expect(normalizeRepoRelativePath("app/models.py")).toBe("app/models.py");
    });
  });

  describe("runBenchmarkRepo", () => {
    it("includes only accepted annotations by default", async () => {
      materializeRepo(tempRoot);

      const mockScan = jest.fn(
        async (): Promise<FixtureScanResult> => ({
          fixture: REPO_KEY,
          findings: [],
          scannedFiles: ["app/models.py"],
        }),
      );

      const result = await runBenchmarkRepo(REPO_KEY, {
        benchmarkRoot: tempRoot,
        scanRepo: mockScan,
      });

      expect(result.evalCases).toHaveLength(1);
      expect(result.evalCases[0]?.id).toBe("accepted-positive");
      expect(mockScan).toHaveBeenCalledTimes(1);
    });

    it("includes proposed annotations when includeProposed is true", async () => {
      materializeRepo(tempRoot);

      const result = await runBenchmarkRepo(REPO_KEY, {
        benchmarkRoot: tempRoot,
        includeProposed: true,
        scanRepo: async () => ({
          fixture: REPO_KEY,
          findings: [],
          scannedFiles: ["app/models.py", "app/payments.py"],
        }),
      });

      expect(result.evalCases.map((entry) => entry.id)).toEqual([
        "accepted-positive",
        "proposed-positive",
      ]);
    });

    it("marks cases unread when evidence files were not scanned", async () => {
      materializeRepo(tempRoot);

      const result = await runBenchmarkRepo(REPO_KEY, {
        benchmarkRoot: tempRoot,
        scanRepo: async () => ({
          fixture: REPO_KEY,
          findings: [],
          scannedFiles: ["other.py"],
        }),
      });

      expect(result.score.scores.unreadCount).toBe(1);
      expect(result.score.caseResults[0]).toMatchObject({
        caseId: "accepted-positive",
        unread: true,
        matched: false,
      });
      expect(result.score.scores.denominators.evaluablePositives).toBe(0);
    });

    it("preserves repository-relative evidence paths on eval cases", async () => {
      materializeRepo(tempRoot);

      const result = await runBenchmarkRepo(REPO_KEY, {
        benchmarkRoot: tempRoot,
        scanRepo: async () => ({
          fixture: REPO_KEY,
          findings: [],
          scannedFiles: [],
        }),
      });

      expect(result.evalCases[0]?.evidence.file_path).toBe("app/models.py");
      expect(result.evalCases[0]?.evidence.file_path).not.toMatch(/^[\\/]/);
    });
  });
});
