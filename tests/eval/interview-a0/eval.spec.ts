import { PINNED_BRIEF_SHA } from "./brief-snapshot";
import { interviewEvalCases } from "./cases";
import {
  assertBriefShaPinned,
  defaultManifestPath,
  loadBriefManifest,
} from "./manifest";
import { RUBRIC_LINES } from "./score-rubric";
import { scoreInterview } from "./score";

describe("eval/interview-a0", () => {
  it("pins the same brief SHA as the skill files (DATAP-671)", () => {
    const manifest = loadBriefManifest(defaultManifestPath);
    assertBriefShaPinned(manifest);
    expect(manifest.commit).toBe(PINNED_BRIEF_SHA);
    expect(manifest.commit).toMatch(/^16f2e85/);
    expect(manifest.repository).toBe("DataParade-io/knowledge-base");
    expect(manifest.brief_path).toBe("project/wiki/dogfood-brief-a0.md");
  });

  it("scores the passing simulated interview with zero violations", () => {
    const passingCase = interviewEvalCases.find((c) => c.id === "a0-passing-simulated")!;
    const report = scoreInterview(passingCase.interview);

    expect(report.passed).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.briefSha).toBe(PINNED_BRIEF_SHA);
  });

  it("scores each rubric-line failure as a fail", () => {
    const failureCases = interviewEvalCases.filter((c) => c.id !== "a0-passing-simulated");

    for (const caseRecord of failureCases) {
      const report = scoreInterview(caseRecord.interview);
      expect(report.passed).toBe(false);

      const violationLines = [...new Set(report.violations.map((v) => v.line))].sort();
      const expected = [...caseRecord.expectedViolations].sort();
      expect(violationLines).toEqual(expected);
    }
  });

  it("covers all six fail-any rubric lines", () => {
    const coveredLines = new Set(
      interviewEvalCases
        .filter((c) => c.expectedViolations.length > 0)
        .flatMap((c) => c.expectedViolations),
    );

    for (const line of RUBRIC_LINES) {
      expect(coveredLines.has(line)).toBe(true);
    }
  });

  it("does not require diagram output or KB mutation to pass", () => {
    const passingCase = interviewEvalCases.find((c) => c.id === "a0-passing-simulated")!;
    const hasDiagramOrKbAction = passingCase.interview.actions.some(
      (action) =>
        action.slot === "container_box" ||
        action.slot === "deploy_topology" ||
        (action.text ?? "").toLowerCase().includes("mermaid") ||
        (action.text ?? "").toLowerCase().includes("kb"),
    );
    expect(hasDiagramOrKbAction).toBe(false);
    expect(scoreInterview(passingCase.interview).passed).toBe(true);
  });
});
