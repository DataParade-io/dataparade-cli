import { dataFlowEvalCases } from "./cases";
import { scanFixtureDataFlows } from "./adapter";
import { scoreEvalCases } from "../../score";

describe("eval/layers/data-flows", () => {
  const fixtures = [...new Set(dataFlowEvalCases.map((caseRecord) => caseRecord.fixture))];

  it("meets data-flow layer ground-truth expectations", async () => {
    const scanResults = await Promise.all(fixtures.map(scanFixtureDataFlows));
    const report = scoreEvalCases(dataFlowEvalCases, scanResults);

    const failingPositives = report.caseResults.filter((result) => {
      const caseRecord = dataFlowEvalCases.find((entry) => entry.id === result.caseId)!;
      return (
        caseRecord.expected.status === "positive" &&
        !caseRecord.expected.documentedGap &&
        !result.unread &&
        !result.matched
      );
    });
    expect(failingPositives).toEqual([]);

    const failingLabelPositives = report.caseResults.filter((result) => {
      const caseRecord = dataFlowEvalCases.find((entry) => entry.id === result.caseId)!;
      return (
        caseRecord.expected.status === "positive" &&
        !caseRecord.expected.documentedGap &&
        result.matched &&
        !result.labelsCorrect
      );
    });
    expect(failingLabelPositives).toEqual([]);

    const failingNegatives = report.caseResults.filter((result) => {
      const caseRecord = dataFlowEvalCases.find((entry) => entry.id === result.caseId)!;
      return caseRecord.expected.status === "negative" && !result.unread && !result.negativeClean;
    });
    expect(failingNegatives).toEqual([]);

    expect(report.scores.unreadCount).toBe(0);

    const ciGatedCases = dataFlowEvalCases.filter(
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

    expect(report.scores.precision).toBeNull();
    expect(report.scores.denominators.exhaustiveScopedFindings).toBe(0);
  });
});
