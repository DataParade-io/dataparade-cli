import fs from "fs";

import { loadDefaultBriefSnapshot } from "./load-brief";
import { RUBRIC_LINES } from "./score-rubric";
import { scoreInterview } from "./score";
import type { RubricLine, SimulatedInterview } from "./types";

export interface RubricLineScore {
  line: RubricLine;
  label: string;
  passed: boolean;
  violations: Array<{ actionIndex: number; message: string }>;
}

export interface TranscriptScoreReport {
  interviewId: string;
  briefSha: string;
  overallPassed: boolean;
  rubricLines: RubricLineScore[];
  violations: Array<{ line: RubricLine; actionIndex: number; message: string }>;
}

const RUBRIC_LABELS: Record<RubricLine, string> = {
  re_ask_known: "1. Asks only unknown rows (no re-ask scan-known)",
  refuse_vs_invent: "2. Refuse-vs-invent",
  no_mush_merge: "3. No mush merges",
  taxonomy_discipline: "4. Taxonomy discipline",
  edge_mode: "5. Edge mode (data-flow only)",
  provenance: "6. Provenance on writes",
};

export function scoreTranscript(interview: SimulatedInterview): TranscriptScoreReport {
  const brief = loadDefaultBriefSnapshot();
  const report = scoreInterview(interview, brief);

  const rubricLines: RubricLineScore[] = RUBRIC_LINES.map((line) => {
    const lineViolations = report.violations.filter((v) => v.line === line);
    return {
      line,
      label: RUBRIC_LABELS[line],
      passed: lineViolations.length === 0,
      violations: lineViolations.map((v) => ({
        actionIndex: v.actionIndex,
        message: v.message,
      })),
    };
  });

  return {
    interviewId: interview.id,
    briefSha: report.briefSha,
    overallPassed: report.passed,
    rubricLines,
    violations: report.violations,
  };
}

export function scoreTranscriptFile(transcriptPath: string): TranscriptScoreReport {
  const raw = fs.readFileSync(transcriptPath, "utf8");
  const interview = JSON.parse(raw) as SimulatedInterview;
  return scoreTranscript(interview);
}

export function writeScoreReport(report: TranscriptScoreReport, outputPath: string): void {
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
