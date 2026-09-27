import fs from "fs";
import path from "path";

import { exportInterviewDiscoveries } from "../../export-interview-discoveries";
import { loadDefaultBriefSnapshot } from "../../load-brief";
import {
  PINNED_BRIEF_SHA,
  PINNED_ONTOLOGY_SHA,
  PINNED_SKILL_SHA,
} from "../../pins";
import {
  assertResponseModelIsLuna,
  assertRunMetaSkillSha,
  mapRawLogToInterviewFile,
} from "./map-raw-to-actions";
import {
  scoreTranscriptFile,
  writeScoreReport,
} from "../../score-transcript";

const experimentDir = __dirname;
const rawLogPath = path.join(experimentDir, "raw-model-transcript.jsonl");
const mappedPath = path.join(experimentDir, "mapped-transcript.json");
const reportPath = path.join(experimentDir, "score-report.json");
const exportBundlePath = path.join(experimentDir, "discovery-export-bundle.json");

const ELIGIBLE_SHAPES = new Set(["D2", "D4", "D7", "D8"]);

describe("DATAP-693 model-run experiment (gpt-5.6-luna, skill f8b4f28)", () => {
  beforeAll(() => {
    if (!fs.existsSync(rawLogPath)) {
      throw new Error(
        `Missing ${rawLogPath}. Run: OPENAI_API_KEY=... node tests/eval/interview-a0/experiments/datap-693/run-model-interview.mjs`,
      );
    }
    assertResponseModelIsLuna(rawLogPath);
    assertRunMetaSkillSha(rawLogPath);
    mapRawLogToInterviewFile(rawLogPath, mappedPath, "datap-693-mapped-from-raw");
  });

  it("maps raw log, scores rubric, and exports interview Discoveries (adapter only)", () => {
    const mapped = JSON.parse(fs.readFileSync(mappedPath, "utf8"));
    expect(mapped.actions.length).toBeGreaterThan(0);
    expect(mapped.description).toContain("Mechanical mapper output");

    const report = scoreTranscriptFile(mappedPath);
    writeScoreReport(report, reportPath);

    expect(report.interviewId).toBe("datap-693-mapped-from-raw");
    expect(report.briefSha).toBe(PINNED_BRIEF_SHA);
    expect(report.rubricLines).toHaveLength(6);

    for (const line of report.rubricLines) {
      expect(typeof line.passed).toBe("boolean");
      expect(line.label.length).toBeGreaterThan(0);
    }

    const brief = loadDefaultBriefSnapshot();
    const exportBundle = exportInterviewDiscoveries(mapped, {
      brief,
      briefSha: PINNED_BRIEF_SHA,
      skillSha: PINNED_SKILL_SHA,
      rawEvidenceRef: "transcript:experiments/datap-693/raw-model-transcript.jsonl",
    });
    fs.writeFileSync(exportBundlePath, `${JSON.stringify(exportBundle, null, 2)}\n`, "utf8");

    expect(exportBundle.landable).toBe(false);
    expect(exportBundle.adapter_only).toBe(true);
    expect(exportBundle.ontology_sha).toBe(PINNED_ONTOLOGY_SHA);
    expect(exportBundle.write_back_kb_sha).toBe(PINNED_SKILL_SHA);
    expect(exportBundle.promotion_blocked).toBe(false);
    expect(exportBundle.discoveries.length).toBeGreaterThan(0);
    expect(exportBundle.discoveries.every((record) => record.source === "interview")).toBe(
      true,
    );
    expect(exportBundle.discoveries.every((record) => record.reviewer === undefined)).toBe(
      true,
    );
    expect(
      exportBundle.discoveries.every((record) => ELIGIBLE_SHAPES.has(record.eligible_shape)),
    ).toBe(true);

    console.log(
      JSON.stringify(
        {
          model: "gpt-5.6-luna",
          skillSha: PINNED_SKILL_SHA,
          mappedActionCount: mapped.actions.length,
          overallPassed: report.overallPassed,
          discoveryCount: exportBundle.discoveries.length,
          eligibleShapes: [...new Set(exportBundle.discoveries.map((d) => d.eligible_shape))],
          rubricLines: report.rubricLines.map((l) => ({
            line: l.line,
            passed: l.passed,
            violationCount: l.violations.length,
          })),
        },
        null,
        2,
      ),
    );
  });
});
