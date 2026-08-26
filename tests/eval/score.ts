import type {
  EvalCase,
  EvalCaseResult,
  EvalScoreReport,
  FixtureScanResult,
  LayerFinding,
} from "./types";

function isEvaluablePositive(caseRecord: EvalCase): boolean {
  return caseRecord.expected.status === "positive" && !caseRecord.expected.documentedGap;
}

function isNegativeCase(caseRecord: EvalCase): boolean {
  return caseRecord.expected.status === "negative";
}

function isUnread(caseRecord: EvalCase, scannedFiles: string[]): boolean {
  return !scannedFiles.includes(caseRecord.evidence.file_path);
}

function findFinding(findings: LayerFinding[], key: string): LayerFinding | undefined {
  return findings.find((finding) => finding.key === key);
}

function labelsMatch(finding: LayerFinding, expectedLabels: string[]): boolean {
  if (expectedLabels.length === 0) {
    return true;
  }
  const tags = new Set(finding.labels);
  return expectedLabels.every((label) => tags.has(label));
}

function findingInScope(finding: LayerFinding, scopeFiles: string[]): boolean {
  if (scopeFiles.length === 0) {
    return false;
  }
  return finding.sourceFilePaths.some((filePath) => scopeFiles.includes(filePath));
}

function collectExhaustiveScopes(cases: EvalCase[]): Map<string, string[]> {
  const scopes = new Map<string, string[]>();
  for (const caseRecord of cases) {
    if (!caseRecord.exhaustiveScopeFiles || caseRecord.exhaustiveScopeFiles.length === 0) {
      continue;
    }
    scopes.set(caseRecord.fixture, caseRecord.exhaustiveScopeFiles);
  }
  return scopes;
}

export function scoreEvalCases(
  cases: EvalCase[],
  scanResults: FixtureScanResult[],
): EvalScoreReport {
  const byFixture = new Map(scanResults.map((result) => [result.fixture, result]));

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

    const finding = findFinding(findings, caseRecord.subject.key);
    const matched = Boolean(finding);
    const labelsCorrect = matched && labelsMatch(finding!, caseRecord.expected.labels);
    const documentedGap = Boolean(caseRecord.expected.documentedGap);

    let negativeClean = true;
    if (isNegativeCase(caseRecord)) {
      negativeCases += 1;
      negativeClean = !matched;
      if (negativeClean) {
        negativeCasesPassed += 1;
      }
    }

    if (isEvaluablePositive(caseRecord)) {
      evaluablePositives += 1;
      if (!unread && matched) {
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
    evaluablePositives === 0 ? 1 : matchedPositives / evaluablePositives;
  const labelAccuracy =
    matchedPositives === 0 ? 1 : matchedWithCorrectLabels / matchedPositives;
  const correctLabelRecall =
    evaluablePositives === 0 ? 1 : matchedWithCorrectLabels / evaluablePositives;
  const negativeCasePassRate =
    negativeCases === 0 ? 1 : negativeCasesPassed / negativeCases;

  const acceptedPositiveKeys = new Set(
    cases
      .filter(
        (caseRecord) =>
          caseRecord.expected.status === "positive" &&
          !caseRecord.expected.documentedGap,
      )
      .map((caseRecord) => caseRecord.subject.key),
  );

  let exhaustiveScopedFindings = 0;
  let exhaustiveScopedMatches = 0;

  for (const [fixture, scopeFiles] of collectExhaustiveScopes(cases)) {
    const scan = byFixture.get(fixture);
    if (!scan) {
      continue;
    }
    for (const finding of scan.findings) {
      if (!findingInScope(finding, scopeFiles)) {
        continue;
      }
      exhaustiveScopedFindings += 1;
      if (acceptedPositiveKeys.has(finding.key)) {
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
