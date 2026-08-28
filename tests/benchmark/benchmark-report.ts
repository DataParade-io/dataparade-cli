import { execSync } from "child_process";

import type { BenchmarkRepoResult } from "./run-benchmark";
import type { EvalScoreReport } from "../eval/types";
import type { ReviewState } from "./schema";

export const BENCHMARK_REPORT_SCHEMA_VERSION = "1.0";
export const SCORING_CONTRACT_T0 = "T0";
export const SCORING_CONTRACT_T1 = "T1";

export interface BenchmarkReportCaseOutcome {
  caseId: string;
  fixture: string;
  unread: boolean;
  matched: boolean;
  labelsCorrect: boolean;
  negativeClean: boolean;
  documentedGap: boolean;
}

export interface BenchmarkReportRepo {
  repoKey: string;
  materializedPath: string;
  evalCaseCount: number;
  scannedFileCount: number;
  findingCount: number;
  scores: EvalScoreReport["scores"];
  caseOutcomes: BenchmarkReportCaseOutcome[];
}

export interface BenchmarkReport {
  schemaVersion: typeof BENCHMARK_REPORT_SCHEMA_VERSION;
  scoringContract: typeof SCORING_CONTRACT_T0 | typeof SCORING_CONTRACT_T1;
  gitSha: string;
  generatedAt: string;
  reviewStates: ReviewState[];
  provisional: boolean;
  aggregates: EvalScoreReport["scores"];
  repos: BenchmarkReportRepo[];
}

function resolveGitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function mergeScores(
  left: EvalScoreReport["scores"],
  right: EvalScoreReport["scores"],
): EvalScoreReport["scores"] {
  const evaluablePositives =
    left.denominators.evaluablePositives + right.denominators.evaluablePositives;
  const matchedPositives =
    left.denominators.matchedPositives + right.denominators.matchedPositives;
  const matchedWithCorrectLabels =
    left.denominators.matchedWithCorrectLabels +
    right.denominators.matchedWithCorrectLabels;
  const negativeCases = left.denominators.negativeCases + right.denominators.negativeCases;
  const negativeCasesPassed =
    left.denominators.negativeCasesPassed + right.denominators.negativeCasesPassed;
  const exhaustiveScopedFindings =
    left.denominators.exhaustiveScopedFindings +
    right.denominators.exhaustiveScopedFindings;
  const exhaustiveScopedMatches =
    left.denominators.exhaustiveScopedMatches +
    right.denominators.exhaustiveScopedMatches;

  return {
    recall: evaluablePositives === 0 ? null : matchedPositives / evaluablePositives,
    labelAccuracy:
      matchedPositives === 0 ? null : matchedWithCorrectLabels / matchedPositives,
    correctLabelRecall:
      evaluablePositives === 0
        ? null
        : matchedWithCorrectLabels / evaluablePositives,
    precision:
      exhaustiveScopedFindings === 0
        ? null
        : exhaustiveScopedMatches / exhaustiveScopedFindings,
    negativeCasePassRate:
      negativeCases === 0 ? null : negativeCasesPassed / negativeCases,
    unreadCount: left.unreadCount + right.unreadCount,
    denominators: {
      evaluablePositives,
      matchedPositives,
      matchedWithCorrectLabels,
      negativeCases,
      negativeCasesPassed,
      exhaustiveScopedFindings,
      exhaustiveScopedMatches,
    },
  };
}

export function aggregateBenchmarkScores(
  results: BenchmarkRepoResult[],
): EvalScoreReport["scores"] {
  if (results.length === 0) {
    return {
      recall: null,
      labelAccuracy: null,
      correctLabelRecall: null,
      precision: null,
      negativeCasePassRate: null,
      unreadCount: 0,
      denominators: {
        evaluablePositives: 0,
        matchedPositives: 0,
        matchedWithCorrectLabels: 0,
        negativeCases: 0,
        negativeCasesPassed: 0,
        exhaustiveScopedFindings: 0,
        exhaustiveScopedMatches: 0,
      },
    };
  }

  return results
    .map((result) => result.score.scores)
    .reduce((aggregate, scores) => mergeScores(aggregate, scores));
}

export function buildBenchmarkReport(options: {
  results: BenchmarkRepoResult[];
  reviewStates: ReviewState[];
  provisional: boolean;
  scoringContract?: typeof SCORING_CONTRACT_T0 | typeof SCORING_CONTRACT_T1;
  generatedAt?: string;
  gitSha?: string;
}): BenchmarkReport {
  const {
    results,
    reviewStates,
    provisional,
    scoringContract = SCORING_CONTRACT_T1,
    generatedAt = new Date().toISOString(),
    gitSha = resolveGitSha(),
  } = options;

  return {
    schemaVersion: BENCHMARK_REPORT_SCHEMA_VERSION,
    scoringContract,
    gitSha,
    generatedAt,
    reviewStates,
    provisional,
    aggregates: aggregateBenchmarkScores(results),
    repos: results.map((result) => ({
      repoKey: result.repoKey,
      materializedPath: result.materializedPath,
      evalCaseCount: result.evalCases.length,
      scannedFileCount: result.scanResult.scannedFiles.length,
      findingCount: result.scanResult.findings.length,
      scores: result.score.scores,
      caseOutcomes: result.score.caseResults.map((caseResult) => ({
        caseId: caseResult.caseId,
        fixture: caseResult.fixture,
        unread: caseResult.unread,
        matched: caseResult.matched,
        labelsCorrect: caseResult.labelsCorrect,
        negativeClean: caseResult.negativeClean,
        documentedGap: caseResult.documentedGap,
      })),
    })),
  };
}

export interface BenchmarkComparisonDelta {
  recall: number | null;
  labelAccuracy: number | null;
  correctLabelRecall: number | null;
  matchedPositives: number;
  matchedWithCorrectLabels: number;
  evaluablePositives: number;
}

export function compareBenchmarkReports(
  baseline: BenchmarkReport,
  current: BenchmarkReport,
): BenchmarkComparisonDelta {
  const baselineScores = baseline.aggregates;
  const currentScores = current.aggregates;

  const delta = (currentValue: number | null, baselineValue: number | null): number | null => {
    if (currentValue === null || baselineValue === null) {
      return null;
    }
    return currentValue - baselineValue;
  };

  return {
    recall: delta(currentScores.recall, baselineScores.recall),
    labelAccuracy: delta(currentScores.labelAccuracy, baselineScores.labelAccuracy),
    correctLabelRecall: delta(
      currentScores.correctLabelRecall,
      baselineScores.correctLabelRecall,
    ),
    matchedPositives:
      currentScores.denominators.matchedPositives -
      baselineScores.denominators.matchedPositives,
    matchedWithCorrectLabels:
      currentScores.denominators.matchedWithCorrectLabels -
      baselineScores.denominators.matchedWithCorrectLabels,
    evaluablePositives:
      currentScores.denominators.evaluablePositives -
      baselineScores.denominators.evaluablePositives,
  };
}
