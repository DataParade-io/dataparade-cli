import { briefSnapshot } from "../../eval/interview-a0/brief-snapshot";
import {
  checkEdgeMode,
  checkNoMushMerge,
  checkProvenance,
  checkReAskKnown,
  checkRefuseVsInvent,
  checkTaxonomyDiscipline,
} from "../../eval/interview-a0/score-rubric";
import type { InterviewAction } from "../../eval/interview-a0/types";

describe("interview-a0 score-rubric", () => {
  it("flags re-ask of scan-known flow endpoint", () => {
    const action: InterviewAction = {
      kind: "ask",
      slot: "sends_data_to.endpoint",
      discoveryId: "flow_103",
    };
    expect(checkReAskKnown(action, 0, briefSnapshot)?.line).toBe("re_ask_known");
  });

  it("allows ask on partial-known actor", () => {
    const action: InterviewAction = {
      kind: "ask",
      slot: "actors",
      discoveryId: "cmp_6",
    };
    expect(checkReAskKnown(action, 0, briefSnapshot)).toBeUndefined();
  });

  it("flags invented system boundary", () => {
    const action: InterviewAction = {
      kind: "write",
      slot: "system_boundary",
      value: "includes knowledge-base",
      provenance: "interview",
    };
    expect(checkRefuseVsInvent(action, 0, briefSnapshot)?.line).toBe("refuse_vs_invent");
  });

  it("flags mush merge without interview provenance", () => {
    const action: InterviewAction = {
      kind: "write",
      slot: "external_systems",
      discoveryId: "cmp_3",
      value: "merged:cmp_11",
      provenance: "scan",
    };
    expect(checkNoMushMerge(action, 0, briefSnapshot)?.line).toBe("no_mush_merge");
  });

  it("allows unspecified purpose", () => {
    const action: InterviewAction = {
      kind: "write",
      slot: "sends_data_to.purpose",
      discoveryId: "flow_103",
      value: "unspecified",
      provenance: "interview",
    };
    expect(checkTaxonomyDiscipline(action, 0, briefSnapshot)).toBeUndefined();
  });

  it("flags out-of-A0 edge mode", () => {
    const action: InterviewAction = {
      kind: "ask",
      slot: "deploy_topology",
    };
    expect(checkEdgeMode(action, 0)?.line).toBe("edge_mode");
  });

  it("flags missing provenance on write", () => {
    const action: InterviewAction = {
      kind: "write",
      slot: "sends_data_to.data_categories",
      discoveryId: "flow_103",
      value: ["personal"],
    };
    expect(checkProvenance(action, 0)?.line).toBe("provenance");
  });
});
