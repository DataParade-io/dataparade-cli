import fs from "fs";
import path from "path";

import { interviewEvalCases } from "../../eval/interview-a0/cases";
import {
  convertExportBundleJson,
  convertExportBundleToLandCandidate,
  LandCandidateConversionError,
  parseExportBundleJson,
} from "../../eval/interview-a0/export-bundle-to-land-candidate";
import { exportInterviewDiscoveries } from "../../eval/interview-a0/export-interview-discoveries";
import { loadDefaultBriefSnapshot } from "../../eval/interview-a0/load-brief";
import {
  PINNED_BRIEF_SHA,
  PINNED_ONTOLOGY_SHA,
  PINNED_SKILL_SHA,
} from "../../eval/interview-a0/pins";

const FIXED_ASSERTED_AT = "2026-09-16T22:30:00.000Z";
const NON_EXAM_EVIDENCE = "transcript:stakeholder-interviews/2026-09-16-dataparade-a0-review.md";

function buildNonExamExportBundle() {
  const brief = loadDefaultBriefSnapshot();
  const passing = interviewEvalCases.find((c) => c.id === "a0-passing-simulated")!;
  const interview = {
    ...passing.interview,
    id: "production-a0-2026-09-16",
    description: "Non-exam production interview export (DATAP-695 fixture)",
  };
  return exportInterviewDiscoveries(interview, {
    brief,
    briefSha: PINNED_BRIEF_SHA,
    skillSha: PINNED_SKILL_SHA,
    assertedAt: FIXED_ASSERTED_AT,
    rawEvidenceRef: NON_EXAM_EVIDENCE,
  });
}

describe("exportBundleToLandCandidate (DATAP-695)", () => {
  const nonExamBundle = buildNonExamExportBundle();

  it("converts a non-exam export bundle to land-candidate JSON with blank fill-ins", () => {
    const candidate = convertExportBundleToLandCandidate(nonExamBundle, {
      landCandidateId: "non-exam-a0-passing",
      ticket: "DATAP-695",
    });

    expect(candidate.land_candidate_id).toBe("non-exam-a0-passing");
    expect(candidate.reviewer).toBe("");
    expect(candidate.raw_evidence_ref).toBe("");
    expect(candidate.ontology_sha).toBe(PINNED_ONTOLOGY_SHA);
    expect(candidate.skill_sha).toBe(PINNED_SKILL_SHA);
    expect(candidate.brief_sha).toBe(PINNED_BRIEF_SHA);
    expect(candidate.discoveries.length).toBeGreaterThan(0);
    expect(candidate.discoveries.every((d) => ["D2", "D4", "D7", "D8"].includes(d.eligible_shape))).toBe(
      true,
    );
    expect(candidate.discoveries.every((d) => d.source === "interview")).toBe(true);
    expect(candidate.discoveries.every((d) => !("raw_evidence_ref" in d))).toBe(true);
    expect(candidate.discoveries[0]).not.toHaveProperty("brief_sha");
    expect(candidate.discoveries[0]).not.toHaveProperty("skill_sha");
  });

  it("sets reviewer only when explicit human --reviewer is supplied", () => {
    const candidate = convertExportBundleToLandCandidate(nonExamBundle, {
      reviewer: "ryan@dataparade.io",
      reviewedAt: FIXED_ASSERTED_AT,
    });
    expect(candidate.reviewer).toBe("ryan@dataparade.io");
    expect(candidate.reviewed_at).toBe(FIXED_ASSERTED_AT);
  });

  it("rejects automated reviewer ids", () => {
    expect(() =>
      convertExportBundleToLandCandidate(nonExamBundle, {
        reviewer: "gpt-5.6-luna",
      }),
    ).toThrow(LandCandidateConversionError);
  });

  it("rejects exam export file paths", () => {
    const examPath = path.join(
      __dirname,
      "../../eval/interview-a0/experiments/datap-693/discovery-export-bundle.json",
    );
    expect(() =>
      convertExportBundleToLandCandidate(nonExamBundle, { sourcePath: examPath }),
    ).toThrow(/scripted exam folder/);
  });

  it("rejects exam interview_id bundles from stdin-style input", () => {
    const examBundle = {
      ...nonExamBundle,
      interview_id: "datap-693-mapped-from-raw",
    };
    expect(() => convertExportBundleToLandCandidate(examBundle)).toThrow(/scripted exam artifact/);
  });

  it("rejects promotion_blocked export bundles", () => {
    const blocked = {
      ...nonExamBundle,
      promotion_blocked: true,
      promotion_block_reason: "frozen_scripted_exam",
    };
    expect(() => convertExportBundleToLandCandidate(blocked)).toThrow(/promotion_blocked/);
  });

  it("rejects exam raw_evidence_ref inside export discoveries", () => {
    const examEvidenceBundle = {
      ...nonExamBundle,
      discoveries: [
        {
          ...nonExamBundle.discoveries[0],
          raw_evidence_ref: "transcript:experiments/datap-693/raw-model-transcript.jsonl",
        },
      ],
    };
    expect(() => convertExportBundleToLandCandidate(examEvidenceBundle)).toThrow(
      /eval\/experiment artifacts/,
    );
  });

  it("accepts explicit non-exam raw_evidence_ref flag", () => {
    const candidate = convertExportBundleToLandCandidate(nonExamBundle, {
      rawEvidenceRef: NON_EXAM_EVIDENCE,
    });
    expect(candidate.raw_evidence_ref).toBe(NON_EXAM_EVIDENCE);
  });

  it("rejects explicit raw_evidence_ref pointing at exam artifacts", () => {
    expect(() =>
      convertExportBundleToLandCandidate(nonExamBundle, {
        rawEvidenceRef: "transcript:experiments/datap-693/raw-model-transcript.jsonl",
      }),
    ).toThrow(/eval\/experiment artifacts/);
  });

  it("matches committed non-exam export fixture", () => {
    const fixturePath = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "interview-discovery",
      "non-exam-export-bundle.json",
    );
    const fixtureJson = fs.readFileSync(fixturePath, "utf8");
    const fixtureBundle = parseExportBundleJson(fixtureJson);
    const candidate = convertExportBundleToLandCandidate(fixtureBundle, {
      landCandidateId: "from-fixture-non-exam",
    });
    expect(candidate.discoveries.map((d) => d.eligible_shape).sort()).toEqual(
      fixtureBundle.discoveries.map((d) => d.eligible_shape).sort(),
    );
  });
});
