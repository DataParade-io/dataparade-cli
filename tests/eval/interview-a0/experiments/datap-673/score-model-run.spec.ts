import fs from "fs";
import path from "path";

import {
  scoreTranscriptFile,
  writeScoreReport,
} from "../../score-transcript";

const experimentDir = __dirname;
const transcriptPath = path.join(experimentDir, "model-run-transcript.json");
const reportPath = path.join(experimentDir, "score-report.json");

describe("DATAP-673 model-run experiment", () => {
  it("scores the model-run transcript on six named rubric lines", () => {
    const report = scoreTranscriptFile(transcriptPath);
    writeScoreReport(report, reportPath);

    expect(report.interviewId).toBe("datap-673-model-run-2026-09-16");
    expect(report.briefSha).toBe("16f2e857a47d54bfea6ca5d7f23a6c4f2732da29");
    expect(report.rubricLines).toHaveLength(6);

    for (const line of report.rubricLines) {
      // Experiment records pass/fail per line; overall outcome is informational.
      expect(typeof line.passed).toBe("boolean");
      expect(line.label.length).toBeGreaterThan(0);
    }

    console.log(
      JSON.stringify(
        {
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
