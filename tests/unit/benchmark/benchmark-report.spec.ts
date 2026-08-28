import type { BenchmarkRepoResult } from "../../benchmark/run-benchmark";
import {
  aggregateBenchmarkScores,
  buildBenchmarkReport,
  compareBenchmarkReports,
  SCORING_CONTRACT_T0,
  SCORING_CONTRACT_T1,
} from "../../benchmark/benchmark-report";

function makeRepoResult(
  repoKey: string,
  scores: BenchmarkRepoResult["score"]["scores"],
): BenchmarkRepoResult {
  return {
    repoKey,
    materializedPath: `/cache/${repoKey}`,
    evalCases: [],
    scanResult: { fixture: repoKey, findings: [], scannedFiles: [] },
    score: {
      scores,
      caseResults: [],
    },
  };
}

describe("benchmark-report", () => {
  it("builds a versioned report with aggregates and per-repo outcomes", () => {
    const report = buildBenchmarkReport({
      results: [
        makeRepoResult("repo-a", {
          recall: 0.5,
          labelAccuracy: 0,
          correctLabelRecall: 0,
          precision: null,
          negativeCasePassRate: 1,
          unreadCount: 0,
          denominators: {
            evaluablePositives: 2,
            matchedPositives: 1,
            matchedWithCorrectLabels: 0,
            negativeCases: 1,
            negativeCasesPassed: 1,
            exhaustiveScopedFindings: 0,
            exhaustiveScopedMatches: 0,
          },
        }),
      ],
      reviewStates: ["proposed"],
      provisional: true,
      scoringContract: SCORING_CONTRACT_T1,
      generatedAt: "2026-08-28T00:00:00.000Z",
      gitSha: "abc123",
    });

    expect(report.schemaVersion).toBe("1.0");
    expect(report.scoringContract).toBe(SCORING_CONTRACT_T1);
    expect(report.gitSha).toBe("abc123");
    expect(report.reviewStates).toEqual(["proposed"]);
    expect(report.provisional).toBe(true);
    expect(report.aggregates.recall).toBe(0.5);
    expect(report.repos).toHaveLength(1);
    expect(report.repos[0]?.repoKey).toBe("repo-a");
  });

  it("aggregates scores across repositories", () => {
    const aggregate = aggregateBenchmarkScores([
      makeRepoResult("repo-a", {
        recall: 1,
        labelAccuracy: 1,
        correctLabelRecall: 1,
        precision: null,
        negativeCasePassRate: null,
        unreadCount: 1,
        denominators: {
          evaluablePositives: 1,
          matchedPositives: 1,
          matchedWithCorrectLabels: 1,
          negativeCases: 0,
          negativeCasesPassed: 0,
          exhaustiveScopedFindings: 0,
          exhaustiveScopedMatches: 0,
        },
      }),
      makeRepoResult("repo-b", {
        recall: 0,
        labelAccuracy: null,
        correctLabelRecall: 0,
        precision: null,
        negativeCasePassRate: null,
        unreadCount: 0,
        denominators: {
          evaluablePositives: 1,
          matchedPositives: 0,
          matchedWithCorrectLabels: 0,
          negativeCases: 0,
          negativeCasesPassed: 0,
          exhaustiveScopedFindings: 0,
          exhaustiveScopedMatches: 0,
        },
      }),
    ]);

    expect(aggregate.recall).toBe(0.5);
    expect(aggregate.denominators.evaluablePositives).toBe(2);
    expect(aggregate.denominators.matchedPositives).toBe(1);
    expect(aggregate.unreadCount).toBe(1);
  });

  it("compares T1 against a stored T0 baseline", () => {
    const baseline = buildBenchmarkReport({
      results: [
        makeRepoResult("repo-a", {
          recall: 0.369,
          labelAccuracy: 0,
          correctLabelRecall: 0,
          precision: null,
          negativeCasePassRate: 1,
          unreadCount: 29,
          denominators: {
            evaluablePositives: 65,
            matchedPositives: 24,
            matchedWithCorrectLabels: 0,
            negativeCases: 29,
            negativeCasesPassed: 29,
            exhaustiveScopedFindings: 0,
            exhaustiveScopedMatches: 0,
          },
        }),
      ],
      reviewStates: ["proposed"],
      provisional: true,
      scoringContract: SCORING_CONTRACT_T0,
      generatedAt: "2026-08-27T00:00:00.000Z",
      gitSha: "cc99487",
    });
    const current = buildBenchmarkReport({
      results: [
        makeRepoResult("repo-a", {
          recall: 0.5,
          labelAccuracy: 1,
          correctLabelRecall: 0.5,
          precision: null,
          negativeCasePassRate: 1,
          unreadCount: 29,
          denominators: {
            evaluablePositives: 65,
            matchedPositives: 33,
            matchedWithCorrectLabels: 33,
            negativeCases: 29,
            negativeCasesPassed: 29,
            exhaustiveScopedFindings: 0,
            exhaustiveScopedMatches: 0,
          },
        }),
      ],
      reviewStates: ["proposed"],
      provisional: true,
      scoringContract: SCORING_CONTRACT_T1,
      generatedAt: "2026-08-28T00:00:00.000Z",
      gitSha: "abc123",
    });

    const delta = compareBenchmarkReports(baseline, current);
    expect(delta.recall).toBeCloseTo(0.131, 3);
    expect(delta.labelAccuracy).toBe(1);
    expect(delta.matchedPositives).toBe(9);
    expect(delta.matchedWithCorrectLabels).toBe(33);
  });
});
