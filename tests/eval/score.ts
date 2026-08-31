import type {
  EvalCase,
  EvalCaseResult,
  EvalEvidence,
  EvalLayer,
  EvalScoreReport,
  FixtureScanResult,
  LayerFinding,
} from "./types";
import {
  findingsForCaseLayer,
  identitiesMatch,
  isIdentityOnlyLayer,
  labelsMatch,
  normalizeEvalPath,
} from "./identity";

function isNegativeCase(caseRecord: EvalCase): boolean {
  return caseRecord.expected.status === "negative";
}

function isUnread(caseRecord: EvalCase, scannedFiles: string[]): boolean {
  const evidencePath = normalizeEvalPath(caseRecord.evidence.file_path);
  return !scannedFiles.some((filePath) => normalizeEvalPath(filePath) === evidencePath);
}

function lineRangesOverlap(
  a: { start_line: number; end_line: number },
  b: { start_line: number; end_line: number },
): boolean {
  return a.start_line <= b.end_line && b.start_line <= a.end_line;
}

function evidenceOverlaps(
  evidence: EvalEvidence,
  sourceLine: { file_path: string; start_line: number; end_line: number },
): boolean {
  return (
    normalizeEvalPath(evidence.file_path) === normalizeEvalPath(sourceLine.file_path) &&
    lineRangesOverlap(evidence, sourceLine)
  );
}

function findingMatchesCase(finding: LayerFinding, caseRecord: EvalCase): boolean {
  if (!identitiesMatch(finding, caseRecord)) {
    return false;
  }
  if (isIdentityOnlyLayer(caseRecord.layer)) {
    return true;
  }
  return finding.sourceLines.some((line) => evidenceOverlaps(caseRecord.evidence, line));
}

function findMatchingFinding(
  findings: LayerFinding[],
  caseRecord: EvalCase,
): LayerFinding | undefined {
  const layerFindings = findingsForCaseLayer(findings, caseRecord.layer);
  return layerFindings.find((finding) => findingMatchesCase(finding, caseRecord));
}

function findingInScope(finding: LayerFinding, scopeFiles: string[]): boolean {
  if (scopeFiles.length === 0) {
    return false;
  }
  const normalizedScope = new Set(scopeFiles.map(normalizeEvalPath));
  return finding.sourceFilePaths.some((filePath) =>
    normalizedScope.has(normalizeEvalPath(filePath)),
  );
}

function scopeBucketKey(fixture: string, layer: EvalLayer): string {
  return `${fixture}::${layer}`;
}

function collectExhaustiveScopes(
  cases: EvalCase[],
): Map<string, { fixture: string; layer: EvalLayer; files: string[] }> {
  const scopes = new Map<string, { fixture: string; layer: EvalLayer; files: string[] }>();
  for (const caseRecord of cases) {
    if (!caseRecord.exhaustiveScopeFiles || caseRecord.exhaustiveScopeFiles.length === 0) {
      continue;
    }
    const key = scopeBucketKey(caseRecord.fixture, caseRecord.layer);
    const existing = scopes.get(key);
    const nextFiles = [
      ...new Set([
        ...(existing?.files ?? []),
        ...caseRecord.exhaustiveScopeFiles.map(normalizeEvalPath),
      ]),
    ];
    scopes.set(key, {
      fixture: caseRecord.fixture,
      layer: caseRecord.layer,
      files: nextFiles,
    });
  }
  return scopes;
}

function positiveCasesByFixtureLayer(cases: EvalCase[]): Map<string, EvalCase[]> {
  const byBucket = new Map<string, EvalCase[]>();
  for (const caseRecord of cases) {
    if (caseRecord.expected.status !== "positive") {
      continue;
    }
    const key = scopeBucketKey(caseRecord.fixture, caseRecord.layer);
    const fixtureCases = byBucket.get(key) ?? [];
    fixtureCases.push(caseRecord);
    byBucket.set(key, fixtureCases);
  }
  return byBucket;
}

function findingMatchesAnyPositive(
  finding: LayerFinding,
  positives: EvalCase[],
): boolean {
  return positives.some((caseRecord) => findingMatchesCase(finding, caseRecord));
}

export function scoreEvalCases(
  cases: EvalCase[],
  scanResults: FixtureScanResult[],
): EvalScoreReport {
  const byFixture = new Map(scanResults.map((result) => [result.fixture, result]));
  const positivesByBucket = positiveCasesByFixtureLayer(cases);

  const caseResults: EvalCaseResult[] = [];
  let evaluablePositives = 0;
  let matchedPositives = 0;
  let matchedWithCorrectLabels = 0;
  let negativeCases = 0;
  let negativeCasesPassed = 0;
  let unreadCount = 0;

  for (const caseRecord of cases) {
    const scan = byFixture.get(caseRecord.fixture);
    const scannedFiles = scan?.scannedFiles ?? [];
    const findings = scan?.findings ?? [];
    const unread = isUnread(caseRecord, scannedFiles);
    if (unread) {
      unreadCount += 1;
    }

    const finding = findMatchingFinding(findings, caseRecord);
    const matched = Boolean(finding);
    const labelsCorrect = matched && labelsMatch(finding!, caseRecord);
    const documentedGap = Boolean(caseRecord.expected.documentedGap);

    let negativeClean = true;
    if (isNegativeCase(caseRecord)) {
      if (unread) {
        negativeClean = false;
      } else {
        negativeCases += 1;
        negativeClean = !matched;
        if (negativeClean) {
          negativeCasesPassed += 1;
        }
      }
    }

    if (caseRecord.expected.status === "positive" && !unread) {
      evaluablePositives += 1;
      if (matched) {
        matchedPositives += 1;
        if (labelsCorrect) {
          matchedWithCorrectLabels += 1;
        }
      }
    }

    caseResults.push({
      caseId: caseRecord.id,
      fixture: caseRecord.fixture,
      unread,
      matched,
      labelsCorrect,
      negativeClean,
      documentedGap,
    });
  }

  const recall =
    evaluablePositives === 0 ? null : matchedPositives / evaluablePositives;
  const labelAccuracy =
    matchedPositives === 0 ? null : matchedWithCorrectLabels / matchedPositives;
  const correctLabelRecall =
    evaluablePositives === 0 ? null : matchedWithCorrectLabels / evaluablePositives;
  const negativeCasePassRate =
    negativeCases === 0 ? null : negativeCasesPassed / negativeCases;

  let exhaustiveScopedFindings = 0;
  let exhaustiveScopedMatches = 0;

  for (const [bucketKey, scope] of collectExhaustiveScopes(cases)) {
    const scan = byFixture.get(scope.fixture);
    if (!scan) {
      continue;
    }
    const fixturePositives = positivesByBucket.get(bucketKey) ?? [];
    for (const finding of findingsForCaseLayer(scan.findings, scope.layer)) {
      if (!findingInScope(finding, scope.files)) {
        continue;
      }
      exhaustiveScopedFindings += 1;
      if (findingMatchesAnyPositive(finding, fixturePositives)) {
        exhaustiveScopedMatches += 1;
      }
    }
  }

  const precision =
    exhaustiveScopedFindings === 0
      ? null
      : exhaustiveScopedMatches / exhaustiveScopedFindings;

  return {
    scores: {
      recall,
      labelAccuracy,
      correctLabelRecall,
      precision,
      negativeCasePassRate,
      unreadCount,
      denominators: {
        evaluablePositives,
        matchedPositives,
        matchedWithCorrectLabels,
        negativeCases,
        negativeCasesPassed,
        exhaustiveScopedFindings,
        exhaustiveScopedMatches,
      },
    },
    caseResults,
  };
}

const EVAL_LAYERS: EvalLayer[] = [
  "components",
  "data-flows",
  "pii-signals",
  "data-items",
];

export function scoreEvalCasesByLayer(
  cases: EvalCase[],
  scanResults: FixtureScanResult[],
): Partial<Record<EvalLayer, EvalScoreReport>> {
  const reports: Partial<Record<EvalLayer, EvalScoreReport>> = {};
  for (const layer of EVAL_LAYERS) {
    const layerCases = cases.filter((caseRecord) => caseRecord.layer === layer);
    if (layerCases.length === 0) {
      continue;
    }
    reports[layer] = scoreEvalCases(layerCases, scanResults);
  }
  return reports;
}
