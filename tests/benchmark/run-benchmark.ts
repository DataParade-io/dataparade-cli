import fs from "fs";
import path from "path";

import type { EvalCase, EvalScoreReport, FixtureScanResult } from "../eval/types";
import { scoreEvalCases } from "../eval/score";
import { loadAnnotations, loadBenchmarkManifest } from "./manifest";
import { annotationsToEvalCases, type ToEvalCasesOptions } from "./to-eval-cases";
import { normalizeRepoRelativePath, scanRepoComponents } from "./scan-repo";

const DEFAULT_BENCHMARK_ROOT = path.join(__dirname);

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

export function assertMaterialized(repoKey: string, benchmarkRoot?: string): string {
  const materializedPath = resolveMaterializedRepoPath(repoKey, benchmarkRoot);
  if (!fs.existsSync(materializedPath)) {
    throw new MaterializationMissingError(repoKey, materializedPath);
  }
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
  });

  const scanFn = options.scanRepo ?? scanRepoComponents;
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const includeProposed = args.includes("--include-proposed");
  const repoKeys = args.filter((arg) => !arg.startsWith("--"));

  const results = await runBenchmark({
    repoKeys: repoKeys.length > 0 ? repoKeys : undefined,
    includeProposed,
  });

  for (const result of results) {
    printRepoResult(result);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
