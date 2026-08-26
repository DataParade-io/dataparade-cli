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
      return caseRecord.expected.status === "negative" && !result.unread && !result.negativeClean;
    });
    expect(failingNegatives).toEqual([]);

    expect(report.scores.unreadCount).toBe(0);

    const ciGatedCases = componentEvalCases.filter(
      (caseRecord) =>
        caseRecord.expected.status === "positive" && !caseRecord.expected.documentedGap,
    );
    const ciGatedRecall =
      report.scores.denominators.matchedPositives / ciGatedCases.length;
    expect(ciGatedRecall).toBe(1);
    expect(report.scores.negativeCasePassRate).toBe(1);

    const documentedGapMisses = report.caseResults.filter(
      (result) => result.documentedGap && !result.matched,
    );
    expect(documentedGapMisses.length).toBeGreaterThan(0);
    expect(report.scores.recall).toBeLessThan(1);

    // No exhaustive scopes in committed fixtures yet — precision unavailable.
    expect(report.scores.precision).toBeNull();
    expect(report.scores.denominators.exhaustiveScopedFindings).toBe(0);
  });
});
