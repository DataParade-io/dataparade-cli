import { componentEvalCases } from "./layers/components/cases";
import { scanFixtureComponents } from "./layers/components/adapter";
import { scoreEvalCases } from "./score";

describe("debug", () => {
  it("inspect full eval state", async () => {
    const fixtures = [...new Set(componentEvalCases.map((caseRecord) => caseRecord.fixture))];
    const scanResults = await Promise.all(fixtures.map(scanFixtureComponents));
    const report = scoreEvalCases(componentEvalCases, scanResults);
    console.log(JSON.stringify(report, null, 2));
    expect(report.scores.recall).not.toBeNull();
  });
});
