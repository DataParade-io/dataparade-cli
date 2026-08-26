import type {
  EvidenceRef,
  ExhaustiveScope,
  GroundTruthCase,
  LayerScoreResult,
  ReportedFinding,
  ScoredFileCoverage,
} from "./types";

export function evidenceOverlaps(a: EvidenceRef, b: EvidenceRef): boolean {
  if (a.filePath !== b.filePath) {
    return false;
  }
  return a.startLine <= b.endLine && a.endLine >= b.startLine;
}

function findingOverlapsEvidence(
  finding: ReportedFinding,
  evidence: EvidenceRef,
): boolean {
  return finding.evidence.some((ref) => evidenceOverlaps(ref, evidence));
}

function labelsMatch(expected: string[], actual: string[]): boolean {
  const sortedExpected = [...expected].sort();
  const sortedActual = [...actual].sort();
  return (
    sortedExpected.length === sortedActual.length &&
    sortedExpected.every((label, index) => label === sortedActual[index])
  );
}

function overlapScore(finding: ReportedFinding, evidence: EvidenceRef): number {
  let score = 0;
  for (const ref of finding.evidence) {
    if (evidenceOverlaps(ref, evidence)) {
      score += 1;
    }
  }
  return score;
}

function matchFindingToPositiveCase(
  finding: ReportedFinding,
  groundTruth: GroundTruthCase,
): boolean {
  if (finding.identity !== groundTruth.subject.key) {
    return false;
  }
  return findingOverlapsEvidence(finding, groundTruth.evidence);
}

function selectMatchedFinding(
  findings: ReportedFinding[],
  groundTruth: GroundTruthCase,
): ReportedFinding | undefined {
  const candidates = findings.filter(
    (finding) => finding.identity === groundTruth.subject.key,
  );
  if (candidates.length === 0) {
    return undefined;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  let best: ReportedFinding | undefined;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = overlapScore(candidate, groundTruth.evidence);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function findingInScopedFiles(
  finding: ReportedFinding,
  scopedFilePaths: Set<string>,
): boolean {
  return finding.evidence.some((ref) => scopedFilePaths.has(ref.filePath));
}

function countScopedPrecisionFalsePositives(
  findings: ReportedFinding[],
  positiveCases: GroundTruthCase[],
  exhaustiveScopes: ExhaustiveScope[],
): number {
  const scopedFilePaths = new Set<string>();
  for (const scope of exhaustiveScopes) {
    for (const filePath of scope.filePaths) {
      scopedFilePaths.add(filePath);
    }
  }

  if (scopedFilePaths.size === 0) {
    return 0;
  }

  let falsePositives = 0;
  for (const finding of findings) {
    if (!findingInScopedFiles(finding, scopedFilePaths)) {
      continue;
    }

    const matchesPositive = positiveCases.some((groundTruth) =>
      matchFindingToPositiveCase(finding, groundTruth),
    );
    if (!matchesPositive) {
      falsePositives += 1;
    }
  }

  return falsePositives;
}

function countScopedTruePositives(
  findings: ReportedFinding[],
  positiveCases: GroundTruthCase[],
  exhaustiveScopes: ExhaustiveScope[],
): number {
  const scopedFilePaths = new Set<string>();
  for (const scope of exhaustiveScopes) {
    for (const filePath of scope.filePaths) {
      scopedFilePaths.add(filePath);
    }
  }

  if (scopedFilePaths.size === 0) {
    return 0;
  }

  let truePositives = 0;
  for (const finding of findings) {
    if (!findingInScopedFiles(finding, scopedFilePaths)) {
      continue;
    }

    const matchesPositive = positiveCases.some((groundTruth) =>
      matchFindingToPositiveCase(finding, groundTruth),
    );
    if (matchesPositive) {
      truePositives += 1;
    }
  }

  return truePositives;
}

export function scoreLayer(input: {
  findings: ReportedFinding[];
  groundTruth: GroundTruthCase[];
  exhaustiveScopes?: ExhaustiveScope[];
  scannedFiles: ScoredFileCoverage[];
}): LayerScoreResult {
  const { findings, groundTruth, exhaustiveScopes = [], scannedFiles } = input;

  const scannedByPath = new Map(
    scannedFiles.map((entry) => [entry.filePath, entry.scanned]),
  );

  const positiveCases = groundTruth.filter(
    (caseEntry) => caseEntry.expected.status === "positive",
  );
  const evaluablePositives = groundTruth.filter(
    (caseEntry) => caseEntry.expected.status === "positive",
  );
  const negativeCases = groundTruth.filter(
    (caseEntry) => caseEntry.expected.status === "negative",
  );

  let matchedPositives = 0;
  let labelMatches = 0;

  for (const caseEntry of evaluablePositives) {
    const matchedFinding = selectMatchedFinding(findings, caseEntry);
    if (!matchedFinding) {
      continue;
    }

    matchedPositives += 1;
    if (labelsMatch(caseEntry.expected.labels, matchedFinding.labels)) {
      labelMatches += 1;
    }
  }

  let negativePasses = 0;
  for (const caseEntry of negativeCases) {
    const overlappingFinding = findings.some((finding) =>
      findingOverlapsEvidence(finding, caseEntry.evidence),
    );
    if (!overlappingFinding) {
      negativePasses += 1;
    }
  }

  const unreadCount = groundTruth.filter((caseEntry) => {
    const scanned = scannedByPath.get(caseEntry.evidence.filePath);
    return scanned === false;
  }).length;

  const scopedTruePositives = countScopedTruePositives(
    findings,
    positiveCases,
    exhaustiveScopes,
  );
  const scopedFalsePositives = countScopedPrecisionFalsePositives(
    findings,
    positiveCases,
    exhaustiveScopes,
  );

  const evaluablePositiveCount = evaluablePositives.length;
  const negativeCaseCount = negativeCases.length;
  const falseNegativeCount = evaluablePositiveCount - matchedPositives;
  const negativeFailures = negativeCaseCount - negativePasses;

  const recall =
    evaluablePositiveCount === 0
      ? null
      : matchedPositives / evaluablePositiveCount;
  const labelAccuracy =
    matchedPositives === 0 ? null : labelMatches / matchedPositives;
  const correctLabelRecall =
    evaluablePositiveCount === 0
      ? null
      : labelMatches / evaluablePositiveCount;
  const negativeCasePassRate =
    negativeCaseCount === 0 ? null : negativePasses / negativeCaseCount;

  const precisionDenominator = scopedTruePositives + scopedFalsePositives;
  const precision =
    exhaustiveScopes.length === 0 || precisionDenominator === 0
      ? exhaustiveScopes.length === 0
        ? null
        : null
      : scopedTruePositives / precisionDenominator;

  return {
    recall,
    labelAccuracy,
    correctLabelRecall,
    precision,
    negativeCasePassRate,
    unreadCount,
    counts: {
      TP: matchedPositives,
      FP: scopedFalsePositives + negativeFailures,
      FN: falseNegativeCount,
      TN: negativePasses,
      matchedPositives,
      labelMatches,
      evaluablePositives: evaluablePositiveCount,
      negativeCases: negativeCaseCount,
      negativePasses,
    },
  };
}
