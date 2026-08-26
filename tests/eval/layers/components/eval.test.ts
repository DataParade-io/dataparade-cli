import { componentEvalCases } from "./cases";
import { scanFixtureComponents } from "./adapter";
import { scoreEvalCases } from "../../score";

describe("eval/layers/components", () => {
  const fixtures = [...new Set(componentEvalCases.map((caseRecord) => caseRecord.fixture))];

  it("meets component layer ground-truth expectations", async () => {
    const scanResults = await Promise.all(fixtures.map(scanFixtureComponents));
    const report = scoreEvalCases(componentEvalCases, scanResults);

    const failingPositives = report.caseResults.filter((result) => {
      const caseRecord = componentEvalCases.find((entry) => entry.id === result.caseId)!;
      return (
        caseRecord.expected.status === "positive" &&
        !caseRecord.expected.documentedGap &&
        !result.unread &&
        !result.matched
      );
    });
    expect(failingPositives).toEqual([]);

    const failingLabelPositives = report.caseResults.filter((result) => {
      const caseRecord = componentEvalCases.find((entry) => entry.id === result.caseId)!;
      return (
        caseRecord.expected.status === "positive" &&
        !caseRecord.expected.documentedGap &&
        result.matched &&
        !result.labelsCorrect
      );
    });
    expect(failingLabelPositives).toEqual([]);

    const failingNegatives = report.caseResults.filter((result) => {
      const caseRecord = componentEvalCases.find((entry) => entry.id === result.caseId)!;
      return caseRecord.expected.status === "negative" && !result.negativeClean;
    });
    expect(failingNegatives).toEqual([]);

    expect(report.scores.unreadCount).toBe(0);
    expect(report.scores.recall).toBe(1);
    expect(report.scores.correctLabelRecall).toBe(1);
    expect(report.scores.negativeCasePassRate).toBe(1);

    expect(report.scores.precision).not.toBeNull();
    expect(report.scores.denominators.exhaustiveScopedFindings).toBeGreaterThan(0);
  });
});
