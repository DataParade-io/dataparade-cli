import { componentEvalCases } from "./layers/components/cases";
import { scanFixtureComponents } from "./layers/components/adapter";
import { scoreEvalCases } from "./score";

describe("debug", () => {
  it("debug full eval", async () => {
    const fixtures = [...new Set(componentEvalCases.map((caseRecord) => caseRecord.fixture))];
    const scanResults = await Promise.all(fixtures.map(scanFixtureComponents));
    const report = scoreEvalCases(componentEvalCases, scanResults);
    for (const c of componentEvalCases) {
      const r = report.caseResults.find((x) => x.caseId === c.id)!;
      console.log(c.id, c.evidence, { unread: r.unread, matched: r.matched });
    }
    expect(true).toBe(true);
  });
});
