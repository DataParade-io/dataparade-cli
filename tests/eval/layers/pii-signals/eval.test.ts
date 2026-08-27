import { piiSignalEvalCases } from "./cases";
import { scanFixturePiiSignals } from "./adapter";
import { scoreEvalCases } from "../../score";

describe("eval/layers/pii-signals", () => {
  const fixtures = [...new Set(piiSignalEvalCases.map((caseRecord) => caseRecord.fixture))];

  it("meets PII signal layer ground-truth expectations", async () => {
    const scanResults = await Promise.all(fixtures.map(scanFixturePiiSignals));
    const report = scoreEvalCases(piiSignalEvalCases, scanResults);

    const failingPositives = report.caseResults.filter((result) => {
      const caseRecord = piiSignalEvalCases.find((entry) => entry.id === result.caseId)!;
      return (
        caseRecord.expected.status === "positive" &&
        !caseRecord.expected.documentedGap &&
        !result.unread &&
        !result.matched
      );
    });
    expect(failingPositives).toEqual([]);

    const failingLabelPositives = report.caseResults.filter((result) => {
      const caseRecord = piiSignalEvalCases.find((entry) => entry.id === result.caseId)!;
      return (
        caseRecord.expected.status === "positive" &&
        !caseRecord.expected.documentedGap &&
        result.matched &&
        !result.labelsCorrect
      );
    });
    expect(failingLabelPositives).toEqual([]);

    const failingNegatives = report.caseResults.filter((result) => {
      const caseRecord = piiSignalEvalCases.find((entry) => entry.id === result.caseId)!;
      return caseRecord.expected.status === "negative" && !result.unread && !result.negativeClean;
    });
    expect(failingNegatives).toEqual([]);

    expect(report.scores.unreadCount).toBe(0);
    expect(report.scores.recall).toBe(1);
    expect(report.scores.negativeCasePassRate).toBe(1);
    expect(report.scores.precision).toBeNull();
  });
});
