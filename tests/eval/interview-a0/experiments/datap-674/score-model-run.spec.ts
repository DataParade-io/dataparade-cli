import fs from "fs";
import path from "path";

import {
  assertResponseModelIsLuna,
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

describe("DATAP-674 model-run experiment (gpt-5.6-luna)", () => {
  beforeAll(() => {
    if (!fs.existsSync(rawLogPath)) {
      throw new Error(
        `Missing ${rawLogPath}. Run: OPENAI_API_KEY=... node tests/eval/interview-a0/experiments/datap-674/run-model-interview.mjs`,
      );
    }
    assertResponseModelIsLuna(rawLogPath);
    mapRawLogToInterviewFile(rawLogPath, mappedPath, "datap-674-mapped-from-raw");
  });

  it("maps raw API log mechanically and scores six named rubric lines", () => {
    const mapped = JSON.parse(fs.readFileSync(mappedPath, "utf8"));
    expect(mapped.actions.length).toBeGreaterThan(0);
    expect(mapped.description).toContain("Mechanical mapper output");

    const report = scoreTranscriptFile(mappedPath);
    writeScoreReport(report, reportPath);

    expect(report.interviewId).toBe("datap-674-mapped-from-raw");
    expect(report.briefSha).toBe("16f2e857a47d54bfea6ca5d7f23a6c4f2732da29");
    expect(report.rubricLines).toHaveLength(6);

    for (const line of report.rubricLines) {
      expect(typeof line.passed).toBe("boolean");
      expect(line.label.length).toBeGreaterThan(0);
    }

    console.log(
      JSON.stringify(
        {
          model: "gpt-5.6-luna",
          mappedActionCount: mapped.actions.length,
          overallPassed: report.overallPassed,
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
