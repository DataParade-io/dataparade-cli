import type { EvalCase, FixtureScanResult, LayerFinding } from "../../eval/types";
import { scoreEvalCases } from "../../eval/score";

function makeCase(
  overrides: Partial<EvalCase> & Pick<EvalCase, "id" | "fixture" | "subject">,
): EvalCase {
  return {
    layer: "components",
    evidence: { file_path: "app.ts", start_line: 10, end_line: 10 },
    expected: { status: "positive", labels: ["database"] },
    rationale: "synthetic",
    ...overrides,
  };
}

function makeDataItemsCase(
  overrides: Partial<EvalCase> & Pick<EvalCase, "id" | "fixture" | "subject">,
): EvalCase {
  return makeCase({
    layer: "data-items",
    ...overrides,
  });
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

  describe("data-items scoring contract (T1)", () => {
    it("matches privacy taxonomy email_address against scanner user_email labels", () => {
      const evalCase = makeDataItemsCase({
        id: "email-positive",
        fixture: "fixture-a",
        subject: { key: "data_item:email" },
        evidence: { file_path: "app.ts", start_line: 10, end_line: 10 },
        expected: { status: "positive", labels: ["email_address"] },
      });
      const finding = {
        key: "data_item:email",
        labels: ["user_email"],
        sourceFilePaths: ["app.ts"],
        sourceLines: [{ file_path: "app.ts", start_line: 10, end_line: 10 }],
      };
      const report = scoreEvalCases(
        [evalCase],
        [makeScan("fixture-a", [finding], ["app.ts"])],
      );

      expect(report.caseResults[0]?.matched).toBe(true);
      expect(report.caseResults[0]?.labelsCorrect).toBe(true);
    });

    it("matches person_name against first_name scanner labels", () => {
      const evalCase = makeDataItemsCase({
        id: "name-positive",
        fixture: "fixture-a",
        subject: { key: "data_item:first_name" },
        evidence: { file_path: "app.ts", start_line: 4, end_line: 4 },
        expected: { status: "positive", labels: ["person_name"] },
      });
      const finding = {
        key: "data_item:first_name",
        labels: ["first_name"],
        sourceFilePaths: ["app.ts"],
        sourceLines: [{ file_path: "app.ts", start_line: 4, end_line: 4 }],
      };
      const report = scoreEvalCases(
        [evalCase],
        [makeScan("fixture-a", [finding], ["app.ts"])],
      );

      expect(report.caseResults[0]?.labelsCorrect).toBe(true);
    });

    it("matches overlapping lines when data_item keys differ via aliases", () => {
      const evalCase = makeDataItemsCase({
        id: "phone-positive",
        fixture: "fixture-a",
        subject: { key: "data_item:phone" },
        evidence: { file_path: "app.ts", start_line: 12, end_line: 12 },
        expected: { status: "positive", labels: ["phone_number"] },
      });
      const finding = {
        key: "data_item:phone_number",
        labels: ["phone_number"],
        sourceFilePaths: ["app.ts"],
        sourceLines: [{ file_path: "app.ts", start_line: 12, end_line: 12 }],
      };
      const report = scoreEvalCases(
        [evalCase],
        [makeScan("fixture-a", [finding], ["app.ts"])],
      );

      expect(report.caseResults[0]?.matched).toBe(true);
      expect(report.caseResults[0]?.labelsCorrect).toBe(true);
    });

    it("keeps components on exact label matching", () => {
      const evalCase = makeCase({
        id: "component-label",
        fixture: "fixture-a",
        subject: { key: "asset:db" },
        evidence: { file_path: "db.ts", start_line: 1, end_line: 1 },
        expected: { status: "positive", labels: ["database"] },
      });
      const finding = makeFinding("asset:db", [
        { file_path: "db.ts", start_line: 1, end_line: 1 },
      ]);
      finding.labels = ["sql"];
      const report = scoreEvalCases(
        [evalCase],
        [makeScan("fixture-a", [finding], ["db.ts"])],
      );

      expect(report.caseResults[0]?.matched).toBe(true);
      expect(report.caseResults[0]?.labelsCorrect).toBe(false);
    });

    it("keeps components on exact key equality", () => {
      const evalCase = makeCase({
        id: "component-key",
        fixture: "fixture-a",
        subject: { key: "asset:db" },
        evidence: { file_path: "db.ts", start_line: 1, end_line: 1 },
        expected: { status: "positive", labels: ["database"] },
      });
      const finding = makeFinding("asset:other", [
        { file_path: "db.ts", start_line: 1, end_line: 1 },
      ]);
      const report = scoreEvalCases(
        [evalCase],
        [makeScan("fixture-a", [finding], ["db.ts"])],
      );

      expect(report.caseResults[0]?.matched).toBe(false);
    });

    it("does not match data_items cases to non-data_item findings on the same line", () => {
      const evalCase = makeDataItemsCase({
        id: "email-positive",
        fixture: "fixture-a",
        subject: { key: "data_item:email" },
        evidence: { file_path: "app.ts", start_line: 10, end_line: 10 },
        expected: { status: "positive", labels: ["email_address"] },
      });
      const componentFinding = makeFinding("asset:database", [
        { file_path: "app.ts", start_line: 10, end_line: 10 },
      ]);
      const report = scoreEvalCases(
        [evalCase],
        [makeScan("fixture-a", [componentFinding], ["app.ts"])],
      );

      expect(report.caseResults[0]?.matched).toBe(false);
    });
  });
});
