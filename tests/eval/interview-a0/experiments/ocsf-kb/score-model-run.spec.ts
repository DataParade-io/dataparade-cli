import fs from "fs";
import path from "path";

import { gapsFromOcsfDir } from "../../gaps-from-ocsf";
import { exportInterviewDiscoveries } from "../../export-interview-discoveries";
import { PINNED_ONTOLOGY_SHA, PINNED_SKILL_SHA } from "../../pins";
import { RUBRIC_LINES } from "../../score-rubric";
import { scoreInterview } from "../../score";
import type { BriefSnapshot, RubricLine, SimulatedInterview } from "../../types";
import { mapRawLogToInterviewFile } from "./map-raw-to-actions";
import { mkTinyOcsfGapDir } from "./fixtures-ocsf";
import { resolveOcsfKbDir } from "./ocsf-kb-config";

const experimentDir = __dirname;
const rawLogPath = path.join(experimentDir, "raw-model-transcript.jsonl");
const mappedPath = path.join(experimentDir, "mapped-transcript.json");
const reportPath = path.join(experimentDir, "score-report.json");
const exportBundlePath = path.join(experimentDir, "discovery-export-bundle.json");
const gapReportPath = path.join(experimentDir, "gap-report.json");

const RUBRIC_LABELS: Record<RubricLine, string> = {
  re_ask_known: "1. Asks only unknown rows (no re-ask scan-known)",
  refuse_vs_invent: "2. Refuse-vs-invent",
  no_mush_merge: "3. No mush merges",
  taxonomy_discipline: "4. Taxonomy discipline",
  edge_mode: "5. Edge mode (data-flow only)",
  provenance: "6. Provenance on writes",
};

const ELIGIBLE_SHAPES = new Set(["D2", "D4", "D7", "D8"]);

function loadOrComputeGapReport(): ReturnType<typeof gapsFromOcsfDir> {
  if (fs.existsSync(gapReportPath)) {
    return JSON.parse(fs.readFileSync(gapReportPath, "utf8")) as ReturnType<
      typeof gapsFromOcsfDir
    >;
  }
  return gapsFromOcsfDir(resolveOcsfKbDir());
}

function scoreWithSnapshot(interview: SimulatedInterview, snapshot: BriefSnapshot) {
  const report = scoreInterview(interview, snapshot);
  const rubricLines = RUBRIC_LINES.map((line) => {
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

function writeScoreReport(
  report: ReturnType<typeof scoreWithSnapshot>,
  outputPath: string,
): void {
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

const hasRawTranscript = fs.existsSync(rawLogPath);

describe("ocsf-kb model-run experiment (gaps from OCSF store)", () => {
  const liveIt = hasRawTranscript ? it : it.skip;

  liveIt("maps raw log, scores rubric against OCSF snapshot, and exports bundle", () => {
    const gapReport = loadOrComputeGapReport();
    mapRawLogToInterviewFile(rawLogPath, mappedPath, "ocsf-kb-mapped-from-raw");

    const mapped = JSON.parse(fs.readFileSync(mappedPath, "utf8")) as SimulatedInterview;
    expect(mapped.actions.length).toBeGreaterThan(0);

    const report = scoreWithSnapshot(mapped, gapReport.snapshot);
    writeScoreReport(report, reportPath);

    expect(report.briefSha).toBe(gapReport.snapshot.sha);
    expect(report.rubricLines).toHaveLength(6);

    const exportBundle = exportInterviewDiscoveries(mapped, {
      brief: gapReport.snapshot,
      briefSha: gapReport.snapshot.sha,
      skillSha: PINNED_SKILL_SHA,
      rawEvidenceRef: "transcript:experiments/ocsf-kb/raw-model-transcript.jsonl",
    });
    fs.writeFileSync(exportBundlePath, `${JSON.stringify(exportBundle, null, 2)}\n`, "utf8");

    expect(exportBundle.adapter_only).toBe(true);
    expect(exportBundle.ontology_sha).toBe(PINNED_ONTOLOGY_SHA);
    expect(exportBundle.write_back_kb_sha).toBe(PINNED_SKILL_SHA);
    expect(
      exportBundle.discoveries.every((record) => record.source === "interview"),
    ).toBe(true);
    expect(
      exportBundle.discoveries.every((record) => ELIGIBLE_SHAPES.has(record.eligible_shape)),
    ).toBe(true);
  });
});

describe("ocsf-kb harness fixtures (no live transcript)", () => {
  it("fails re_ask_known when transcript asks a scan-known flow endpoint", () => {
    const dir = mkTinyOcsfGapDir();
    const gapReport = gapsFromOcsfDir(dir);

    expect(gapReport.snapshot.scanKnownFlows).toContain("flow_1");

    const interview: SimulatedInterview = {
      id: "ocsf-kb-fail-re-ask-endpoint",
      description: "Re-asks scan-known flow endpoint from tiny OCSF fixture",
      actions: [
        {
          kind: "ask",
          slot: "sends_data_to.endpoint",
          discoveryId: "flow_1",
          text: "Confirm flow_1 endpoint?",
        },
      ],
    };

    const report = scoreInterview(interview, gapReport.snapshot);
    expect(report.passed).toBe(false);
    expect(report.violations.some((v) => v.line === "re_ask_known")).toBe(true);
  });

  it("passes when transcript only asks and writes OCSF-derived gaps", () => {
    const dir = mkTinyOcsfGapDir();
    const gapReport = gapsFromOcsfDir(dir);

    expect(gapReport.gaps.length).toBeGreaterThan(0);
    expect(
      gapReport.gaps.every(
        (gap) =>
          gap.slot === "sends_data_to.data_categories" || gap.slot === "sends_data_to.purpose",
      ),
    ).toBe(true);

    const actions: SimulatedInterview["actions"] = [];
    for (const gap of gapReport.gaps) {
      actions.push({
        kind: "ask",
        slot: gap.slot,
        discoveryId: gap.entityId,
        text: `Ask ${gap.slot} for ${gap.entityId}`,
      });
      if (gap.slot === "sends_data_to.data_categories") {
        actions.push({
          kind: "write",
          slot: gap.slot,
          discoveryId: gap.entityId,
          value: ["other"],
          provenance: "interview",
        });
      } else if (gap.slot === "sends_data_to.purpose") {
        actions.push({
          kind: "write",
          slot: gap.slot,
          discoveryId: gap.entityId,
          value: "unspecified",
          provenance: "interview",
        });
      }
    }

    const interview: SimulatedInterview = {
      id: "ocsf-kb-pass-gap-only",
      description: "Only gap slots from tiny OCSF dir",
      actions,
    };

    const report = scoreInterview(interview, gapReport.snapshot);
    expect(report.passed).toBe(true);
    expect(report.violations).toHaveLength(0);
  });
});
