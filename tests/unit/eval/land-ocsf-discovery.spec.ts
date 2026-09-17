import fs from "fs";
import os from "os";
import path from "path";

import { DOGFOOD_BRIEF_GATE } from "../../eval/interview-a0/dogfood-brief-gate";
import { landCandidateDiscoveryToOcsf } from "../../eval/interview-a0/land-candidate-to-ocsf";
import {
  LandRejection,
  landOcsfDiscoveries,
  loadLandCandidate,
  validateLandCandidate,
} from "../../eval/interview-a0/land-ocsf-discovery";
import type { LandCandidate } from "../../eval/interview-a0/land-candidate-types";
import { ocsfDiscoveryRecordSchema } from "../../eval/interview-a0/ocsf-discovery-types";
import { PINNED_OCSF_ONTOLOGY_VERSION } from "../../eval/interview-a0/ocsf-pins";

const RYAN_CANDIDATE_PATH = path.join(
  __dirname,
  "../../../../knowledge-base/project/wiki/graph/dogfood/land-candidates/ryan-a0-dogfood-2026-09-17.json",
);

function loadRyanCandidate(): LandCandidate {
  if (!fs.existsSync(RYAN_CANDIDATE_PATH)) {
    throw new Error(`Ryan land candidate fixture missing: ${RYAN_CANDIDATE_PATH}`);
  }
  return loadLandCandidate(RYAN_CANDIDATE_PATH);
}

describe("landOcsfDiscovery (DATAP-696)", () => {
  const ryanCandidate = loadRyanCandidate();

  it("validates Ryan land candidate with human reviewer and brief gate", () => {
    const { reviewer, rawEvidenceRef } = validateLandCandidate(ryanCandidate);
    expect(reviewer).toBe("ryan@dataparade.io");
    expect(rawEvidenceRef).toContain("2026-09-17-ryan-a0-dogfood-interview.md");
  });

  it("converts a discovery to OCSF Architecture Discovery wire record", () => {
    const discovery = ryanCandidate.discoveries[0];
    const record = landCandidateDiscoveryToOcsf(
      discovery,
      ryanCandidate,
      "ryan@dataparade.io",
      ryanCandidate.raw_evidence_ref,
    );

    expect(ocsfDiscoveryRecordSchema.parse(record)).toEqual(record);
    expect(record.class_uid).toBe(900101);
    expect(record.metadata.version).toBe("1.7.0");
    expect(record.dataparade.ontology_version).toBe(PINNED_OCSF_ONTOLOGY_VERSION);
    expect(record.dataparade.source).toBe("interview");
    expect(record.dataparade.reviewer).toBe("ryan@dataparade.io");
    expect(record.dataparade.brief_sha).toBe(ryanCandidate.brief_sha);
  });

  it("dry-runs Ryan candidate without writing files", () => {
    const result = landOcsfDiscoveries(ryanCandidate, { dryRun: true });
    expect(result.landed_count).toBe(45);
    expect(result.reviewer).toBe("ryan@dataparade.io");
    expect(result.dry_run).toBe(true);
    expect(result.landed.every((row) => row.ocsf_path.endsWith(".json"))).toBe(true);
  });

  it("lands OCSF JSON files to a temp output dir", () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocsf-land-"));
    const result = landOcsfDiscoveries(ryanCandidate, { outputDir });
    expect(result.landed_count).toBe(45);
    expect(fs.readdirSync(outputDir).filter((f) => f.endsWith(".json")).length).toBe(45);

    const samplePath = path.join(outputDir, result.landed[0].ocsf_path);
    const sample = JSON.parse(fs.readFileSync(samplePath, "utf8")) as unknown;
    ocsfDiscoveryRecordSchema.parse(sample);
  });

  it("rejects missing human reviewer", () => {
    const bad = { ...ryanCandidate, reviewer: "" };
    expect(() => validateLandCandidate(bad)).toThrow(LandRejection);
    expect(() => validateLandCandidate(bad)).toThrow(/Human reviewer is required/);
  });

  it("rejects automated reviewer ids", () => {
    const bad = { ...ryanCandidate, reviewer: "gpt-5.6-luna" };
    expect(() => validateLandCandidate(bad)).toThrow(/not a human id/);
  });

  it("rejects unspecified data_categories on D7", () => {
    const bad: LandCandidate = {
      ...ryanCandidate,
      discoveries: [
        {
          ...ryanCandidate.discoveries.find((d) => d.eligible_shape === "D7")!,
          asserted_value: '["unspecified"]',
        },
      ],
    };
    expect(() => validateLandCandidate(bad)).toThrow(/unspecified is not a DataCategory/);
  });

  it("rejects scan-wins D4 actor not partial-known", () => {
    const d4 = ryanCandidate.discoveries.find((d) => d.eligible_shape === "D4")!;
    const bad: LandCandidate = {
      ...ryanCandidate,
      discoveries: [
        {
          ...d4,
          asserts: "dp:scan/entity/cmp_999",
        },
      ],
    };
    expect(() => validateLandCandidate(bad)).toThrow(/not partial-known/);
  });

  it("rejects exam land-candidate paths", () => {
    expect(() =>
      landOcsfDiscoveries(ryanCandidate, {
        dryRun: true,
        candidatePath:
          "/tmp/dataparade-cli/tests/eval/interview-a0/experiments/datap-693/land-candidate.json",
      }),
    ).toThrow(/scripted exam folder/);
  });

  it("rejects eval raw_evidence_ref", () => {
    const bad = {
      ...ryanCandidate,
      raw_evidence_ref: "transcript:experiments/datap-693/raw-model-transcript.jsonl",
    };
    expect(() => validateLandCandidate(bad)).toThrow(/eval\/experiment artifacts/);
  });

  it("rejects duplicate land when output file already exists", () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocsf-dup-"));
    landOcsfDiscoveries(ryanCandidate, { outputDir });
    expect(() => landOcsfDiscoveries(ryanCandidate, { outputDir })).toThrow(/already exists/);
  });

  it("rejects D7 flow not in brief gate scan_known_flows", () => {
    const d7 = ryanCandidate.discoveries.find((d) => d.eligible_shape === "D7")!;
    const badGate = {
      ...DOGFOOD_BRIEF_GATE,
      scan_known_flows: new Set<string>(),
    };
    const bad: LandCandidate = {
      ...ryanCandidate,
      discoveries: [d7],
    };
    expect(() => validateLandCandidate(bad, badGate)).toThrow(/not scan-known/);
  });
});
