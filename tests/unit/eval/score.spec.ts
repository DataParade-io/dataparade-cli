import type { EvalCase, FixtureScanResult, LayerFinding } from "../../eval/types";
import { scoreEvalCases } from "../../eval/score";

function makeCase(overrides: Partial<EvalCase> & Pick<EvalCase, "id" | "fixture" | "subject">): EvalCase {
  return {
    layer: "components",
    evidence: { file_path: "app.ts", start_line: 10, end_line: 10 },
    expected: { status: "positive", labels: ["database"] },
    rationale: "synthetic",
    ...overrides,
  };
}

function makeFinding(
  key: string,
  sourceLines: LayerFinding["sourceLines"],
): LayerFinding {
  return {
    key,
    labels: ["database"],
    sourceFilePaths: [...new Set(sourceLines.map((line) => line.file_path))],
    sourceLines,
  };
}

function makeScan(fixture: string, findings: LayerFinding[], scannedFiles: string[]): FixtureScanResult {
  return { fixture, findings, scannedFiles };
}

describe("scoreEvalCases", () => {
  it("requires subject key and overlapping evidence, not identity alone", () => {
    const evalCase = makeCase({
      id: "db-positive",
      fixture: "fixture-a",
      subject: { key: "asset:db" },
      evidence: { file_path: "db.ts", start_line: 1, end_line: 3 },
    });
    const wrongLineFinding = makeFinding("asset:db", [
      { file_path: "db.ts", start_line: 99, end_line: 99 },
    ]);
    const report = scoreEvalCases(
      [evalCase],
      [makeScan("fixture-a", [wrongLineFinding], ["db.ts"])],
    );

    expect(report.caseResults[0]?.matched).toBe(false);
    expect(report.scores.recall).toBe(0);
    expect(report.scores.denominators.evaluablePositives).toBe(1);
    expect(report.scores.denominators.matchedPositives).toBe(0);
  });

  it("matches when key and evidence ranges overlap", () => {
    const evalCase = makeCase({
      id: "db-positive",
      fixture: "fixture-a",
      subject: { key: "asset:db" },
      evidence: { file_path: "db.ts", start_line: 2, end_line: 4 },
    });
    const finding = makeFinding("asset:db", [
      { file_path: "db.ts", start_line: 1, end_line: 3 },
    ]);
    const report = scoreEvalCases(
      [evalCase],
      [makeScan("fixture-a", [finding], ["db.ts"])],
    );

    expect(report.caseResults[0]?.matched).toBe(true);
    expect(report.scores.recall).toBe(1);
  });

  it("excludes unread positives from recall denominators", () => {
    const evalCase = makeCase({
      id: "unread-positive",
      fixture: "fixture-a",
      subject: { key: "asset:db" },
      evidence: { file_path: "missing.ts", start_line: 1, end_line: 1 },
    });
    const report = scoreEvalCases([evalCase], [makeScan("fixture-a", [], ["other.ts"])]);

    expect(report.scores.unreadCount).toBe(1);
    expect(report.caseResults[0]?.unread).toBe(true);
    expect(report.caseResults[0]?.matched).toBe(false);
    expect(report.scores.recall).toBeNull();
    expect(report.scores.denominators.evaluablePositives).toBe(0);
  });

  it("does not treat unread negatives as clean passes", () => {
    const evalCase = makeCase({
      id: "unread-negative",
      fixture: "fixture-a",
      subject: { key: "third_party:stripe" },
      evidence: { file_path: "missing.ts", start_line: 1, end_line: 1 },
      expected: { status: "negative", labels: [] },
    });
    const finding = makeFinding("third_party:stripe", [
      { file_path: "other.ts", start_line: 1, end_line: 1 },
    ]);
    const report = scoreEvalCases(
      [evalCase],
      [makeScan("fixture-a", [finding], ["other.ts"])],
    );

    expect(report.scores.unreadCount).toBe(1);
    expect(report.caseResults[0]?.negativeClean).toBe(false);
    expect(report.scores.negativeCasePassRate).toBeNull();
    expect(report.scores.denominators.negativeCases).toBe(0);
    expect(report.scores.denominators.negativeCasesPassed).toBe(0);
  });

  it("counts documented gaps as evaluable misses instead of inflating recall", () => {
    const gapCase = makeCase({
      id: "documented-gap",
      fixture: "fixture-a",
      subject: { key: "asset:psycopg2" },
      evidence: { file_path: "app.py", start_line: 7, end_line: 7 },
      expected: { status: "positive", labels: ["database"], documentedGap: true },
    });
    const report = scoreEvalCases([gapCase], [makeScan("fixture-a", [], ["app.py"])]);

    expect(report.caseResults[0]?.documentedGap).toBe(true);
    expect(report.caseResults[0]?.matched).toBe(false);
    expect(report.scores.denominators.evaluablePositives).toBe(1);
    expect(report.scores.recall).toBe(0);
    expect(report.scores.correctLabelRecall).toBe(0);
  });

  it("scopes precision per fixture and requires evidence overlap", () => {
    const fixtureACase = makeCase({
      id: "fixture-a-positive",
      fixture: "fixture-a",
      subject: { key: "asset:db" },
      evidence: { file_path: "db.ts", start_line: 1, end_line: 1 },
      exhaustiveScopeFiles: ["db.ts"],
    });
    const fixtureBCase = makeCase({
      id: "fixture-b-positive",
      fixture: "fixture-b",
      subject: { key: "asset:db" },
      evidence: { file_path: "db.ts", start_line: 5, end_line: 5 },
      exhaustiveScopeFiles: ["db.ts"],
    });
    const borrowedKeyFinding = makeFinding("asset:db", [
      { file_path: "db.ts", start_line: 99, end_line: 99 },
    ]);
    const report = scoreEvalCases(
      [fixtureACase, fixtureBCase],
      [
        makeScan("fixture-a", [], ["db.ts"]),
        makeScan("fixture-b", [borrowedKeyFinding], ["db.ts"]),
      ],
    );

    expect(report.scores.recall).toBe(0);
    expect(report.scores.precision).toBe(0);
    expect(report.scores.denominators.exhaustiveScopedFindings).toBe(1);
    expect(report.scores.denominators.exhaustiveScopedMatches).toBe(0);
  });

  it("returns null for empty recall, label accuracy, and negative denominators", () => {
    const report = scoreEvalCases([], []);

    expect(report.scores.recall).toBeNull();
    expect(report.scores.labelAccuracy).toBeNull();
    expect(report.scores.correctLabelRecall).toBeNull();
    expect(report.scores.negativeCasePassRate).toBeNull();
    expect(report.scores.precision).toBeNull();
  });

  it("returns null label accuracy when positives exist but none match", () => {
    const evalCase = makeCase({
      id: "unmatched-positive",
      fixture: "fixture-a",
      subject: { key: "asset:db" },
      evidence: { file_path: "db.ts", start_line: 1, end_line: 1 },
    });
    const report = scoreEvalCases([evalCase], [makeScan("fixture-a", [], ["db.ts"])]);

    expect(report.scores.recall).toBe(0);
    expect(report.scores.labelAccuracy).toBeNull();
    expect(report.scores.denominators.matchedPositives).toBe(0);
  });

  it("matches data-items by identity without requiring span overlap", () => {
    const evalCase = makeCase({
      id: "ssn-item",
      fixture: "fixture-a",
      layer: "data-items",
      subject: { key: "data_item:social_security_number" },
      evidence: { file_path: "app.py", start_line: 40, end_line: 40 },
      expected: { status: "positive", labels: ["national_identifier"] },
    });
    const finding = {
      ...makeFinding("data_item:ssn", [{ file_path: "app.py", start_line: 5, end_line: 5 }]),
      labels: ["social_security_number"],
      layer: "data-items" as const,
    };
    const report = scoreEvalCases(
      [evalCase],
      [makeScan("fixture-a", [finding], ["app.py"])],
    );

    expect(report.caseResults[0]?.matched).toBe(true);
    expect(report.caseResults[0]?.labelsCorrect).toBe(true);
    expect(report.scores.recall).toBe(1);
  });

  it("does not let another layer's findings inflate precision", () => {
    const componentCase = makeCase({
      id: "db-positive",
      fixture: "fixture-a",
      layer: "components",
      subject: { key: "asset:db" },
      evidence: { file_path: "db.ts", start_line: 1, end_line: 1 },
      exhaustiveScopeFiles: ["db.ts"],
    });
    const piiCase = makeCase({
      id: "email-positive",
      fixture: "fixture-a",
      layer: "pii-signals",
      subject: { key: "pii:email_address" },
      evidence: { file_path: "db.ts", start_line: 2, end_line: 2 },
      expected: { status: "positive", labels: ["email_address"] },
      exhaustiveScopeFiles: ["db.ts"],
    });
    const componentFinding = {
      ...makeFinding("asset:db", [{ file_path: "db.ts", start_line: 1, end_line: 1 }]),
      layer: "components" as const,
    };
    const extraPiiFinding = {
      ...makeFinding("pii_signal:username", [
        { file_path: "db.ts", start_line: 9, end_line: 9 },
      ]),
      labels: ["username"],
      layer: "pii-signals" as const,
    };
    const report = scoreEvalCases(
      [componentCase, piiCase],
      [makeScan("fixture-a", [componentFinding, extraPiiFinding], ["db.ts"])],
    );

    expect(report.scores.denominators.exhaustiveScopedFindings).toBe(2);
    expect(report.scores.denominators.exhaustiveScopedMatches).toBe(1);
    expect(report.scores.precision).toBe(0.5);
    expect(report.caseResults.find((entry) => entry.caseId === "db-positive")?.matched).toBe(
      true,
    );
    expect(report.caseResults.find((entry) => entry.caseId === "email-positive")?.matched).toBe(
      false,
    );
  });

  it("unions exhaustive scope files across annotations for a fixture layer", () => {
    const first = makeCase({
      id: "first",
      fixture: "fixture-a",
      subject: { key: "asset:db" },
      evidence: { file_path: "a.ts", start_line: 1, end_line: 1 },
      exhaustiveScopeFiles: ["a.ts"],
    });
    const second = makeCase({
      id: "second",
      fixture: "fixture-a",
      subject: { key: "asset:cache" },
      evidence: { file_path: "b.ts", start_line: 1, end_line: 1 },
      exhaustiveScopeFiles: ["b.ts"],
    });
    const unmatchedOnB = makeFinding("asset:other", [
      { file_path: "b.ts", start_line: 2, end_line: 2 },
    ]);
    const report = scoreEvalCases(
      [first, second],
      [makeScan("fixture-a", [unmatchedOnB], ["a.ts", "b.ts"])],
    );

    expect(report.scores.denominators.exhaustiveScopedFindings).toBe(1);
    expect(report.scores.precision).toBe(0);
  });

  it("normalizes evidence paths when deciding unread", () => {
    const evalCase = makeCase({
      id: "posix-path",
      fixture: "fixture-a",
      subject: { key: "asset:db" },
      evidence: { file_path: "./app/models.py", start_line: 1, end_line: 1 },
    });
    const report = scoreEvalCases(
      [evalCase],
      [makeScan("fixture-a", [], ["app/models.py"])],
    );

    expect(report.caseResults[0]?.unread).toBe(false);
    expect(report.scores.denominators.evaluablePositives).toBe(1);
  });
});
