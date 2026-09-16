import fs from "fs";
import path from "path";

import { interviewEvalCases } from "../../eval/interview-a0/cases";
import { exportInterviewDiscoveries } from "../../eval/interview-a0/export-interview-discoveries";
import {
  PINNED_BRIEF_SHA,
  PINNED_ONTOLOGY_SHA,
  PINNED_SKILL_SHA,
} from "../../eval/interview-a0/pins";
import { loadDefaultBriefSnapshot } from "../../eval/interview-a0/load-brief";
import type { SimulatedInterview } from "../../eval/interview-a0/types";

const FIXED_ASSERTED_AT = "2026-09-16T16:30:00.000Z";

describe("exportInterviewDiscoveries (DATAP-690)", () => {
  const brief = loadDefaultBriefSnapshot();

  it("exports D2/D4/D7/D8 interview Discoveries from the passing simulated interview", () => {
    const passing = interviewEvalCases.find((c) => c.id === "a0-passing-simulated")!;
    const exportBundle = exportInterviewDiscoveries(passing.interview, {
      brief,
      briefSha: PINNED_BRIEF_SHA,
      skillSha: PINNED_SKILL_SHA,
      assertedAt: FIXED_ASSERTED_AT,
      rawEvidenceRef: "transcript:unit-test/passing-simulated.txt",
      reviewer: "ryan",
      reviewedAt: FIXED_ASSERTED_AT,
    });

    expect(exportBundle.landable).toBe(false);
    expect(exportBundle.adapter_only).toBe(true);
    expect(exportBundle.ontology_sha).toBe(PINNED_ONTOLOGY_SHA);
    expect(exportBundle.write_back_kb_sha).toBe(PINNED_SKILL_SHA);
    expect(exportBundle.promotion_blocked).toBe(false);
    expect(exportBundle.discoveries.every((d) => d.source === "interview")).toBe(true);
    expect(exportBundle.discoveries.map((d) => d.eligible_shape).sort()).toEqual([
      "D2",
      "D4",
      "D7",
      "D7",
      "D8",
    ]);

    const actorKind = exportBundle.discoveries.find((d) => d.eligible_shape === "D2");
    expect(actorKind).toMatchObject({
      asserts: "dp:scan/entity/cmp_6",
      asserted_slot: "actor_kind",
      asserted_value: "persona",
      reviewer: "ryan",
    });

    const system = exportBundle.discoveries.find((d) => d.eligible_shape === "D8");
    expect(system).toMatchObject({
      asserts: "dp:a0/system",
      asserted_slot: "in_scope",
      asserted_value: "DataParade",
    });
  });

  it("matches committed fixture for passing simulated export", () => {
    const passing = interviewEvalCases.find((c) => c.id === "a0-passing-simulated")!;
    const exportBundle = exportInterviewDiscoveries(passing.interview, {
      brief,
      assertedAt: FIXED_ASSERTED_AT,
      rawEvidenceRef: "transcript:unit-test/passing-simulated.txt",
    });

    const fixturePath = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "interview-discovery",
      "passing-simulated-export.json",
    );
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
      discoveries: Array<{ eligible_shape: string; asserted_slot: string }>;
      refused_codes: string[];
    };

    expect(exportBundle.discoveries.map((d) => d.eligible_shape).sort()).toEqual(
      fixture.discoveries.map((d) => d.eligible_shape).sort(),
    );
    expect(
      exportBundle.refused
        .map((r) => r.code)
        .filter((code) => code !== "NOT_INTERVIEW_WRITE")
        .sort(),
    ).toEqual(fixture.refused_codes.sort());
  });

  it("refuses D9 boundary and mush-merge writes fail-closed", () => {
    const boundary = interviewEvalCases.find((c) => c.id === "fail-invent-boundary")!;
    const boundaryExport = exportInterviewDiscoveries(boundary.interview, {
      brief,
      assertedAt: FIXED_ASSERTED_AT,
    });
    expect(boundaryExport.discoveries).toHaveLength(0);
    expect(boundaryExport.refused.some((r) => r.code === "D9_BOUNDARY")).toBe(true);

    const mush = interviewEvalCases.find((c) => c.id === "fail-mush-merge")!;
    const mushExport = exportInterviewDiscoveries(mush.interview, { brief, assertedAt: FIXED_ASSERTED_AT });
    expect(mushExport.discoveries).toHaveLength(0);
    expect(mushExport.refused.some((r) => r.code === "MUSH_MERGE")).toBe(true);
  });

  it("refuses D5 scan identity rewrite and D6 endpoint slot writes", () => {
    const identityRewrite: SimulatedInterview = {
      id: "unit-d5-identity",
      description: "Attempt to rewrite scan-known Auth0 identity",
      actions: [
        {
          kind: "write",
          slot: "external_systems",
          discoveryId: "cmp_12",
          value: "Auth0-renamed",
          provenance: "interview",
        },
      ],
    };
    const d5 = exportInterviewDiscoveries(identityRewrite, { brief, assertedAt: FIXED_ASSERTED_AT });
    expect(d5.discoveries).toHaveLength(0);
    expect(d5.refused.some((r) => r.code === "D5_IDENTITY_REWRITE")).toBe(true);

    const endpointReask: SimulatedInterview = {
      id: "unit-d6-endpoint",
      description: "Attempt endpoint rewrite on scan-known flow",
      actions: [
        {
          kind: "write",
          slot: "sends_data_to.endpoint",
          discoveryId: "flow_103",
          value: "cmp_7->cmp_99",
          provenance: "interview",
        },
      ],
    };
    const d6 = exportInterviewDiscoveries(endpointReask, { brief, assertedAt: FIXED_ASSERTED_AT });
    expect(d6.discoveries).toHaveLength(0);
    expect(d6.refused.some((r) => r.code === "D6_ENDPOINT_REASK")).toBe(true);
  });

  it("blocks frozen scripted exam promotion (datap-673/674/676)", () => {
    const frozen: SimulatedInterview = {
      id: "datap-676-replay",
      description: "Replay of DATAP-676 scripted stakeholder exam",
      actions: interviewEvalCases.find((c) => c.id === "a0-passing-simulated")!.interview.actions,
    };
    const exportBundle = exportInterviewDiscoveries(frozen, { brief, assertedAt: FIXED_ASSERTED_AT });
    expect(exportBundle.promotion_blocked).toBe(true);
    expect(exportBundle.discoveries).toHaveLength(0);
    expect(exportBundle.refused.some((r) => r.code === "FROZEN_SCRIPTED_EXAM")).toBe(true);
  });

  it("omits reviewer unless caller supplies a human id", () => {
    const passing = interviewEvalCases.find((c) => c.id === "a0-passing-simulated")!;
    const withoutReviewer = exportInterviewDiscoveries(passing.interview, {
      brief,
      assertedAt: FIXED_ASSERTED_AT,
    });
    expect(withoutReviewer.discoveries.every((d) => d.reviewer === undefined)).toBe(true);

    expect(() =>
      exportInterviewDiscoveries(passing.interview, {
        brief,
        assertedAt: FIXED_ASSERTED_AT,
        reviewer: "gpt-5.6-luna",
      }),
    ).toThrow(/not a human id/);
  });

  it("never emits scan/cloud source or Finding class", () => {
    const passing = interviewEvalCases.find((c) => c.id === "a0-passing-simulated")!;
    const exportBundle = exportInterviewDiscoveries(passing.interview, {
      brief,
      assertedAt: FIXED_ASSERTED_AT,
    });
    const serialized = JSON.stringify(exportBundle);
    expect(serialized).not.toMatch(/"source":"scan"/);
    expect(serialized).not.toMatch(/"source":"cloud"/);
    expect(serialized).not.toMatch(/"Finding"/);
  });
});
