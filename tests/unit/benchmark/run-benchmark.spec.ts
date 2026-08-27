import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import type { FixtureScanResult } from "../../eval/types";
import {
  assertMaterialized,
  MaterializationInvalidError,
  MaterializationMissingError,
  resolveMaterializedRepoPath,
  runBenchmarkRepo,
} from "../../benchmark/run-benchmark";
import { normalizeRepoRelativePath } from "../../benchmark/scan-repo";

const REPO_KEY = "test-repo";

function writeYaml(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function createBenchmarkFixture(root: string, commit: string): void {
  const repoDir = path.join(root, "repos", REPO_KEY);
  writeYaml(
    path.join(repoDir, "manifest.yaml"),
    `repository: example/test-repo
commit: ${commit}
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

function materializedPath(root: string, commit: string): string {
  return path.join(root, ".cache", "repos", `${REPO_KEY}@${commit}`);
}

function initGitRepo(targetDir: string, options: { withApp?: boolean; sparse?: boolean } = {}): string {
  const { withApp = true, sparse = true } = options;
  fs.mkdirSync(targetDir, { recursive: true });
  if (withApp) {
    fs.mkdirSync(path.join(targetDir, "app"), { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, "app", "models.py"),
      "class DB:\n    pass\n",
      "utf8",
    );
  } else {
    fs.writeFileSync(path.join(targetDir, "README.md"), "placeholder\n", "utf8");
  }

  execSync("git init", { cwd: targetDir, stdio: "ignore" });
  execSync("git config user.email test@test.com", { cwd: targetDir, stdio: "ignore" });
  execSync("git config user.name test", { cwd: targetDir, stdio: "ignore" });
  execSync("git add .", { cwd: targetDir, stdio: "ignore" });
  execSync("git commit -m init", { cwd: targetDir, stdio: "ignore" });

  if (sparse && withApp) {
    execSync("git sparse-checkout init --cone", { cwd: targetDir, stdio: "ignore" });
    execSync("git sparse-checkout set app", { cwd: targetDir, stdio: "ignore" });
  }

  return execSync("git rev-parse HEAD", { cwd: targetDir, encoding: "utf8" }).trim();
}

function materializeValidRepo(root: string): { path: string; commit: string } {
  const scratchDir = fs.mkdtempSync(path.join(root, ".scratch-"));
  const commit = initGitRepo(scratchDir);
  createBenchmarkFixture(root, commit);
  const finalPath = materializedPath(root, commit);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.renameSync(scratchDir, finalPath);
  return { path: finalPath, commit };
}

describe("benchmark run-benchmark", () => {
  let tempRoot: string;
  let validCommit: string;
  let validPath: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "benchmark-run-"));
    const materialized = materializeValidRepo(tempRoot);
    validCommit = materialized.commit;
    validPath = materialized.path;
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  describe("resolveMaterializedRepoPath", () => {
    it("resolves cache path from manifest commit", () => {
      expect(resolveMaterializedRepoPath(REPO_KEY, tempRoot)).toBe(
        path.join(tempRoot, ".cache", "repos", `${REPO_KEY}@${validCommit}`),
      );
    });
  });

  describe("assertMaterialized", () => {
    it("throws a clear error when materialization is missing", () => {
      fs.rmSync(validPath, { recursive: true, force: true });
      const expectedPath = path.join(
        tempRoot,
        ".cache",
        "repos",
        `${REPO_KEY}@${validCommit}`,
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

    it("returns the materialized path when the cache is a valid pinned checkout", () => {
      expect(assertMaterialized(REPO_KEY, tempRoot)).toBe(validPath);
    });

    it("rejects a non-git cache directory", () => {
      fs.rmSync(validPath, { recursive: true, force: true });
      fs.mkdirSync(path.join(validPath, "app"), { recursive: true });
      fs.writeFileSync(path.join(validPath, "app", "models.py"), "x", "utf8");

      expect(() => assertMaterialized(REPO_KEY, tempRoot)).toThrow(
        MaterializationInvalidError,
      );
      expect(() => assertMaterialized(REPO_KEY, tempRoot)).toThrow(/not a git repository/);
      expect(() => assertMaterialized(REPO_KEY, tempRoot)).toThrow(
        `pnpm run benchmark:materialize ${REPO_KEY}`,
      );
    });

    it("rejects a cache pinned at the wrong commit", () => {
      const wrongCommit = "cccccccccccccccccccccccccccccccccccccccc";
      createBenchmarkFixture(tempRoot, wrongCommit);
      const wrongPath = materializedPath(tempRoot, wrongCommit);
      fs.rmSync(validPath, { recursive: true, force: true });
      initGitRepo(wrongPath);

      expect(() => assertMaterialized(REPO_KEY, tempRoot)).toThrow(
        MaterializationInvalidError,
      );
      expect(() => assertMaterialized(REPO_KEY, tempRoot)).toThrow(/commit mismatch/);
    });

    it("rejects a cache that is missing scoped paths", () => {
      fs.rmSync(path.join(validPath, "app"), { recursive: true, force: true });

      expect(() => assertMaterialized(REPO_KEY, tempRoot)).toThrow(
        MaterializationInvalidError,
      );
      expect(() => assertMaterialized(REPO_KEY, tempRoot)).toThrow(/missing scope paths/);
    });

    it("rejects a cache with incomplete sparse checkout", () => {
      fs.rmSync(path.join(validPath, ".git", "info", "sparse-checkout"), {
        force: true,
      });

      expect(() => assertMaterialized(REPO_KEY, tempRoot)).toThrow(
        MaterializationInvalidError,
      );
      expect(() => assertMaterialized(REPO_KEY, tempRoot)).toThrow(
        /sparse checkout not configured/,
      );
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

    it("refuses to score against an invalid cache", async () => {
      fs.rmSync(validPath, { recursive: true, force: true });
      fs.mkdirSync(validPath, { recursive: true });

      await expect(
        runBenchmarkRepo(REPO_KEY, {
          benchmarkRoot: tempRoot,
          scanRepo: async () => ({
            fixture: REPO_KEY,
            findings: [],
            scannedFiles: [],
          }),
        }),
      ).rejects.toThrow(MaterializationInvalidError);
    });
  });
});
