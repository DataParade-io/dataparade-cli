import fs from "fs";
import path from "path";

import type { EvalCase, EvalScoreReport, FixtureScanResult } from "../eval/types";
import { scoreEvalCases } from "../eval/score";
import {
  buildBenchmarkReport,
  compareBenchmarkReports,
  SCORING_CONTRACT_T1,
  type BenchmarkReport,
} from "./benchmark-report";
import { loadAnnotations, loadBenchmarkManifest } from "./manifest";
import type { ReviewState } from "./schema";
import { annotationsToEvalCases, type ToEvalCasesOptions } from "./to-eval-cases";
import { normalizeRepoRelativePath, scanRepoByManifestLayers } from "./scan-repo";
import { resolveDefaultBenchmarkRoot } from "./paths";
import {
  MaterializationInvalidError,
  validateMaterializedRepo,
} from "./validate-materialization";

const DEFAULT_BENCHMARK_ROOT = resolveDefaultBenchmarkRoot();

export function getBenchmarkRoot(benchmarkRoot?: string): string {
  return benchmarkRoot ?? DEFAULT_BENCHMARK_ROOT;
}

export function getReposMetadataRoot(benchmarkRoot?: string): string {
  return path.join(getBenchmarkRoot(benchmarkRoot), "repos");
}

export function getCacheRoot(benchmarkRoot?: string): string {
  return path.join(getBenchmarkRoot(benchmarkRoot), ".cache", "repos");
}

export function listBenchmarkRepoKeys(benchmarkRoot?: string): string[] {
  const reposRoot = getReposMetadataRoot(benchmarkRoot);
  return fs
    .readdirSync(reposRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function resolveMaterializedRepoPath(
  repoKey: string,
  benchmarkRoot?: string,
): string {
  const repoDir = path.join(getReposMetadataRoot(benchmarkRoot), repoKey);
  const manifest = loadBenchmarkManifest(repoDir);
  return path.join(getCacheRoot(benchmarkRoot), `${repoKey}@${manifest.commit}`);
}

export class MaterializationMissingError extends Error {
  readonly repoKey: string;
  readonly expectedPath: string;

  constructor(repoKey: string, expectedPath: string) {
    super(
      `Benchmark repo '${repoKey}' is not materialized at ${expectedPath}. ` +
        `Run: pnpm run benchmark:materialize ${repoKey}`,
    );
    this.name = "MaterializationMissingError";
    this.repoKey = repoKey;
    this.expectedPath = expectedPath;
  }
}

export { MaterializationInvalidError } from "./validate-materialization";

export function assertMaterialized(repoKey: string, benchmarkRoot?: string): string {
  const materializedPath = resolveMaterializedRepoPath(repoKey, benchmarkRoot);
  if (!fs.existsSync(materializedPath)) {
    throw new MaterializationMissingError(repoKey, materializedPath);
  }

  const repoDir = path.join(getReposMetadataRoot(benchmarkRoot), repoKey);
  const manifest = loadBenchmarkManifest(repoDir);
  validateMaterializedRepo(repoKey, materializedPath, manifest);
  return materializedPath;
}

export interface RunBenchmarkRepoOptions extends ToEvalCasesOptions {
  benchmarkRoot?: string;
  scanRepo?: (repoKey: string, repoRoot: string) => Promise<FixtureScanResult>;
}

export interface BenchmarkRepoResult {
  repoKey: string;
  materializedPath: string;
  evalCases: EvalCase[];
  scanResult: FixtureScanResult;
  score: EvalScoreReport;
}

export interface RunBenchmarkOptions extends RunBenchmarkRepoOptions {
  repoKeys?: string[];
}

function loadEvalCasesForRepo(
  repoKey: string,
  benchmarkRoot?: string,
  options: ToEvalCasesOptions = {},
): EvalCase[] {
  const repoDir = path.join(getReposMetadataRoot(benchmarkRoot), repoKey);
  const manifest = loadBenchmarkManifest(repoDir);
  const evalCases: EvalCase[] = [];

  for (const layer of manifest.coverage.layers) {
    const annotations = loadAnnotations(repoDir, layer);
    evalCases.push(...annotationsToEvalCases(annotations, repoKey, options));
  }

  return evalCases;
}

export async function runBenchmarkRepo(
  repoKey: string,
  options: RunBenchmarkRepoOptions = {},
): Promise<BenchmarkRepoResult> {
  const materializedPath = assertMaterialized(repoKey, options.benchmarkRoot);
  const evalCases = loadEvalCasesForRepo(repoKey, options.benchmarkRoot, {
    includeProposed: options.includeProposed,
    reviewStates: options.reviewStates,
  });

  const repoDir = path.join(getReposMetadataRoot(options.benchmarkRoot), repoKey);
  const manifest = loadBenchmarkManifest(repoDir);
  const scanFn =
    options.scanRepo ??
    ((key: string, root: string) =>
      scanRepoByManifestLayers(key, root, manifest.coverage.layers));
  const scanResult = await scanFn(repoKey, materializedPath);
  const score = scoreEvalCases(evalCases, [scanResult]);

  return {
    repoKey,
    materializedPath,
    evalCases,
    scanResult,
    score,
  };
}

export async function runBenchmark(
  options: RunBenchmarkOptions = {},
): Promise<BenchmarkRepoResult[]> {
  const repoKeys =
    options.repoKeys ?? listBenchmarkRepoKeys(options.benchmarkRoot);

  const results: BenchmarkRepoResult[] = [];
  for (const repoKey of repoKeys) {
    results.push(await runBenchmarkRepo(repoKey, options));
  }
  return results;
}

function formatRate(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function printRepoResult(result: BenchmarkRepoResult): void {
  const { repoKey, materializedPath, evalCases, scanResult, score } = result;
  console.log(`\n=== ${repoKey} ===`);
  console.log(`Materialized: ${materializedPath}`);
  console.log(`Eval cases: ${evalCases.length}`);
  console.log(`Scanned files: ${scanResult.scannedFiles.length}`);
  console.log(`Findings: ${scanResult.findings.length}`);
  console.log(`Recall: ${formatRate(score.scores.recall)}`);
  console.log(`Label accuracy: ${formatRate(score.scores.labelAccuracy)}`);
  console.log(`Correct-label recall: ${formatRate(score.scores.correctLabelRecall)}`);
  console.log(`Precision: ${formatRate(score.scores.precision)}`);
  console.log(`Negative pass rate: ${formatRate(score.scores.negativeCasePassRate)}`);
  console.log(`Unread cases: ${score.scores.unreadCount}`);

  const unreadCases = score.caseResults.filter((caseResult) => caseResult.unread);
  if (unreadCases.length > 0) {
    console.log("Unread evidence files:");
    for (const caseResult of unreadCases) {
      const evalCase = evalCases.find((entry) => entry.id === caseResult.caseId);
      if (evalCase) {
        console.log(`  - ${evalCase.id}: ${evalCase.evidence.file_path}`);
      }
    }
  }
}

function parseReviewStates(args: string[]): {
  reviewStates?: ReviewState[];
  includeProposed?: boolean;
} {
  const reviewStatesArg = args.find((arg) => arg.startsWith("--review-states="));
  if (reviewStatesArg) {
    const value = reviewStatesArg.slice("--review-states=".length);
    const states = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as ReviewState[];
    if (states.length > 0) {
      return { reviewStates: states };
    }
  }
  const includeProposed = args.includes("--include-proposed");
  return { includeProposed };
}

function parseOutputPath(args: string[]): string | undefined {
  const outputArg = args.find((arg) => arg.startsWith("--output="));
  if (outputArg) {
    return outputArg.slice("--output=".length);
  }
  const outputIndex = args.indexOf("--output");
  if (outputIndex >= 0) {
    return args[outputIndex + 1];
  }
  return undefined;
}

function parseCompareToPath(args: string[]): string | undefined {
  const compareArg = args.find((arg) => arg.startsWith("--compare-to="));
  if (compareArg) {
    return compareArg.slice("--compare-to=".length);
  }
  const compareIndex = args.indexOf("--compare-to");
  if (compareIndex >= 0) {
    return args[compareIndex + 1];
  }
  return undefined;
}

function resolvedReviewStates(options: ToEvalCasesOptions): ReviewState[] {
  return (
    options.reviewStates ??
    (options.includeProposed
      ? ["proposed", "needs_adjudication", "accepted"]
      : ["accepted"])
  );
}

function isProvisionalRun(options: ToEvalCasesOptions): boolean {
  return !resolvedReviewStates(options).every((state) => state === "accepted");
}

export function writeBenchmarkReport(
  report: BenchmarkReport,
  outputPath: string,
): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function loadBenchmarkReport(reportPath: string): BenchmarkReport {
  return JSON.parse(fs.readFileSync(reportPath, "utf8")) as BenchmarkReport;
}

function printComparisonDelta(
  baseline: BenchmarkReport,
  current: BenchmarkReport,
): void {
  const delta = compareBenchmarkReports(baseline, current);
  console.log("\n=== Comparison vs baseline ===");
  console.log(`Baseline contract: ${baseline.scoringContract} (${baseline.gitSha})`);
  console.log(`Current contract: ${current.scoringContract} (${current.gitSha})`);
  console.log(
    `Recall delta: ${delta.recall === null ? "n/a" : `${(delta.recall * 100).toFixed(1)} pts`}`,
  );
  console.log(
    `Label accuracy delta: ${
      delta.labelAccuracy === null ? "n/a" : `${(delta.labelAccuracy * 100).toFixed(1)} pts`
    }`,
  );
  console.log(
    `Correct-label recall delta: ${
      delta.correctLabelRecall === null
        ? "n/a"
        : `${(delta.correctLabelRecall * 100).toFixed(1)} pts`
    }`,
  );
  console.log(`Matched positives delta: ${delta.matchedPositives}`);
  console.log(`Label-correct delta: ${delta.matchedWithCorrectLabels}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { reviewStates, includeProposed } = parseReviewStates(args);
  const outputPath = parseOutputPath(args);
  const compareToPath = parseCompareToPath(args);
  const repoKeys = args.filter(
    (arg) =>
      !arg.startsWith("--") &&
      arg !== outputPath &&
      arg !== compareToPath,
  );

  const options: RunBenchmarkOptions = {
    repoKeys: repoKeys.length > 0 ? repoKeys : undefined,
    includeProposed,
    reviewStates,
  };

  if (isProvisionalRun(options)) {
    console.log(
      "\n*** PROVISIONAL BENCHMARK RUN ***\n" +
        "Metrics include non-accepted annotations. Do not cite as headline metrics.\n" +
        "Accept annotations before reporting final scores.\n",
    );
  }

  const results = await runBenchmark(options);

  for (const result of results) {
    printRepoResult(result);
  }

  if (outputPath) {
    const report = buildBenchmarkReport({
      results,
      reviewStates: resolvedReviewStates(options),
      provisional: isProvisionalRun(options),
      scoringContract: SCORING_CONTRACT_T1,
    });
    writeBenchmarkReport(report, outputPath);
    console.log(`\nWrote benchmark report: ${outputPath}`);
  }

  if (compareToPath) {
    const baseline = loadBenchmarkReport(compareToPath);
    const current = buildBenchmarkReport({
      results,
      reviewStates: resolvedReviewStates(options),
      provisional: isProvisionalRun(options),
      scoringContract: SCORING_CONTRACT_T1,
    });
    printComparisonDelta(baseline, current);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
