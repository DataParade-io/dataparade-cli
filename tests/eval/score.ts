import type {
  EvalCase,
  EvalCaseResult,
  EvalEvidence,
  EvalScoreReport,
  FixtureScanResult,
  LayerFinding,
} from "./types";

function isNegativeCase(caseRecord: EvalCase): boolean {
  return caseRecord.expected.status === "negative";
}

function isUnread(caseRecord: EvalCase, scannedFiles: string[]): boolean {
  return !scannedFiles.includes(caseRecord.evidence.file_path);
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
    evidence.file_path === sourceLine.file_path &&
    lineRangesOverlap(evidence, sourceLine)
  );
}

function findingMatchesCase(finding: LayerFinding, caseRecord: EvalCase): boolean {
  if (finding.key !== caseRecord.subject.key) {
    return false;
  }
  return finding.sourceLines.some((line) => evidenceOverlaps(caseRecord.evidence, line));
}

function findMatchingFinding(
  findings: LayerFinding[],
  caseRecord: EvalCase,
): LayerFinding | undefined {
  return findings.find((finding) => findingMatchesCase(finding, caseRecord));
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

function positiveCasesByFixture(cases: EvalCase[]): Map<string, EvalCase[]> {
  const byFixture = new Map<string, EvalCase[]>();
  for (const caseRecord of cases) {
    if (caseRecord.expected.status !== "positive") {
      continue;
    }
    const fixtureCases = byFixture.get(caseRecord.fixture) ?? [];
    fixtureCases.push(caseRecord);
    byFixture.set(caseRecord.fixture, fixtureCases);
  }
  return byFixture;
}

function findingMatchesAnyPositiveInFixture(
  finding: LayerFinding,
  fixturePositives: EvalCase[],
): boolean {
  return fixturePositives.some((caseRecord) => findingMatchesCase(finding, caseRecord));
}

export function scoreEvalCases(
  cases: EvalCase[],
  scanResults: FixtureScanResult[],
): EvalScoreReport {
  const byFixture = new Map(scanResults.map((result) => [result.fixture, result]));
  const positivesByFixture = positiveCasesByFixture(cases);

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
    const labelsCorrect = matched && labelsMatch(finding!, caseRecord.expected.labels);
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

  for (const [fixture, scopeFiles] of collectExhaustiveScopes(cases)) {
    const scan = byFixture.get(fixture);
    if (!scan) {
      continue;
    }
    const fixturePositives = positivesByFixture.get(fixture) ?? [];
    for (const finding of scan.findings) {
      if (!findingInScope(finding, scopeFiles)) {
        continue;
      }
      exhaustiveScopedFindings += 1;
      if (findingMatchesAnyPositiveInFixture(finding, fixturePositives)) {
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
