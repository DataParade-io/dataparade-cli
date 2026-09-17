import fs from "fs";
import path from "path";

import { loadDefaultBriefSnapshot } from "./load-brief";
import { interviewEvalCases } from "./cases";
import {
  assertManifestPins,
  defaultManifestPath,
  loadBriefManifest,
} from "./manifest";
import {
  PINNED_BRIEF_SHA,
  PINNED_ONTOLOGY_SHA,
  PINNED_ONTOLOGY_VERSION,
  PINNED_SKILL_SHA,
} from "./pins";
import { RUBRIC_LINES } from "./score-rubric";
import { scoreInterview } from "./score";
import type { BriefSnapshot } from "./types";

describe("eval/interview-a0", () => {
  let brief: BriefSnapshot;

  beforeAll(() => {
    brief = loadDefaultBriefSnapshot();
  });

  it("pins source SHAs and checked-in dpkb fixtures (DATAP-671 / DATAP-687)", () => {
    const manifest = loadBriefManifest(defaultManifestPath);
    assertManifestPins(manifest);
    expect(manifest.commit).toBe(PINNED_BRIEF_SHA);
    expect(manifest.skill_commit).toBe(PINNED_SKILL_SHA);
    expect(manifest.ontology_version).toBe(PINNED_ONTOLOGY_VERSION);
    expect(manifest.ontology_sha).toBe(PINNED_ONTOLOGY_SHA);
    expect(manifest.repository).toBe("DataParade-io/knowledge-base");
    expect(manifest.brief_path).toBe("project/wiki/dogfood-brief-a0.md");
    expect(brief.sha).toBe(PINNED_BRIEF_SHA);
  });

  it("cites Discovery write-back model in pinned skill fixture (DATAP-687)", () => {
    const manifest = loadBriefManifest(defaultManifestPath);
    const skillMarkdown = fs.readFileSync(
      path.join(__dirname, "fixtures", manifest.skill_fixture),
      "utf8",
    );
    const writeBackMarkdown = fs.readFileSync(
      path.join(__dirname, "fixtures", manifest.write_back_fixture),
      "utf8",
    );

    expect(skillMarkdown).toContain("source=interview");
    expect(skillMarkdown).toContain("Discovery");
    expect(writeBackMarkdown).toContain("source=interview");
    expect(writeBackMarkdown).toContain("DATAP-669 eval freeze");
  });

  it("scores the passing simulated interview with zero violations", () => {
    const passingCase = interviewEvalCases.find((c) => c.id === "a0-passing-simulated")!;
    const report = scoreInterview(passingCase.interview, brief);

    expect(report.passed).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.briefSha).toBe(PINNED_BRIEF_SHA);
  });

  it("scores each rubric-line failure as a fail", () => {
    const failureCases = interviewEvalCases.filter((c) => c.id !== "a0-passing-simulated");

    for (const caseRecord of failureCases) {
      const report = scoreInterview(caseRecord.interview, brief);
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
    expect(scoreInterview(passingCase.interview, brief).passed).toBe(true);
  });
});
