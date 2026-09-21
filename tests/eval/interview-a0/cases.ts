import type { InterviewEvalCase } from "./types";

/** Golden passing interview — asks unknown slots only, records provenance. */
const passingInterview: InterviewEvalCase = {
  id: "a0-passing-simulated",
  rationale:
    "Simulated interview fills unknown data_categories/purpose per flow and system boundary via interview without re-asking scan-known endpoints.",
  expectedViolations: [],
  interview: {
    id: "a0-passing-simulated",
    description: "Compliant A0 data-flow interview against pinned brief",
    actions: [
      {
        kind: "ask",
        slot: "system_identity",
        text: "Confirm the system name and in_scope for DataParade.",
      },
      {
        kind: "write",
        slot: "system_identity",
        value: "DataParade",
        provenance: "interview",
      },
      {
        kind: "ask",
        slot: "system_boundary",
        text: "Which repos are in scope for this system?",
      },
      {
        kind: "refuse",
        slot: "system_boundary",
        text: "Boundary unknown — sibling repos not promoted without interview evidence.",
      },
      {
        kind: "ask",
        slot: "actors",
        discoveryId: "cmp_6",
        text: "Confirm Customer actor (cmp_6) ActorKind.",
      },
      {
        kind: "write",
        slot: "actors",
        discoveryId: "cmp_6",
        value: "persona",
        provenance: "interview",
      },
      {
        kind: "ask",
        slot: "sends_data_to.data_categories",
        discoveryId: "flow_103",
        text: "What data categories does flow_103 carry?",
      },
      {
        kind: "write",
        slot: "sends_data_to.data_categories",
        discoveryId: "flow_103",
        value: ["identifiers", "contact"],
        provenance: "interview",
      },
      {
        kind: "ask",
        slot: "sends_data_to.purpose",
        discoveryId: "flow_103",
        text: "What is the purpose of flow_103?",
      },
      {
        kind: "write",
        slot: "sends_data_to.purpose",
        discoveryId: "flow_103",
        value: "service_provision",
        provenance: "interview",
      },
      {
        kind: "ask",
        slot: "sends_data_to.purpose",
        discoveryId: "flow_109",
        text: "What is the purpose of flow_109?",
      },
      {
        kind: "write",
        slot: "sends_data_to.purpose",
        discoveryId: "flow_109",
        value: "unspecified",
        provenance: "interview",
      },
    ],
  },
};

/** Per-rubric negative micro-fixtures. */
const rubricFailureCases: InterviewEvalCase[] = [
  {
    id: "fail-re-ask-known-flow",
    rationale: "Re-asking scan-known flow endpoint flow_103 violates rubric line 1.",
    expectedViolations: ["re_ask_known"],
    interview: {
      id: "fail-re-ask-known-flow",
      description: "Re-asks scan-known flow endpoint",
      actions: [
        {
          kind: "ask",
          slot: "sends_data_to.endpoint",
          discoveryId: "flow_103",
          text: "Does backend send data to Sendgrid?",
        },
      ],
    },
  },
  {
    id: "fail-invent-boundary",
    rationale: "Promoting sibling repo into system boundary violates rubric line 2.",
    expectedViolations: ["refuse_vs_invent"],
    interview: {
      id: "fail-invent-boundary",
      description: "Invents system boundary by promoting dataparade-cli",
      actions: [
        {
          kind: "write",
          slot: "system_boundary",
          value: "dataparade-cli is in scope",
          provenance: "interview",
        },
      ],
    },
  },
  {
    id: "fail-mush-merge",
    rationale: "Collapsing duplicate Aws ids without interview provenance violates rubric line 3.",
    expectedViolations: ["no_mush_merge"],
    interview: {
      id: "fail-mush-merge",
      description: "Merges cmp_3 and cmp_11 without interview provenance",
      actions: [
        {
          kind: "write",
          slot: "external_systems",
          discoveryId: "cmp_3",
          value: "merged:cmp_11",
          provenance: "scan",
        },
      ],
    },
  },
  {
    id: "fail-taxonomy",
    rationale: "Purpose value outside ontology enum violates rubric line 4.",
    expectedViolations: ["taxonomy_discipline"],
    interview: {
      id: "fail-taxonomy",
      description: "Writes invented purpose value",
      actions: [
        {
          kind: "write",
          slot: "sends_data_to.purpose",
          discoveryId: "flow_103",
          value: "surveillance",
          provenance: "interview",
        },
      ],
    },
  },
  {
    id: "fail-edge-mode",
    rationale: "Dependency-only interacts_with slot violates rubric line 5.",
    expectedViolations: ["edge_mode"],
    interview: {
      id: "fail-edge-mode",
      description: "Asks about dependency-only interacts_with",
      actions: [
        {
          kind: "ask",
          slot: "interacts_with",
          discoveryId: "cmp_7",
          text: "What services does backend depend on?",
        },
      ],
    },
  },
  {
    id: "fail-provenance",
    rationale: "Writing known slot without provenance violates rubric line 6.",
    expectedViolations: ["provenance"],
    interview: {
      id: "fail-provenance",
      description: "Writes data_categories without provenance",
      actions: [
        {
          kind: "write",
          slot: "sends_data_to.data_categories",
          discoveryId: "flow_103",
          value: ["personal"],
        },
      ],
    },
  },
];

export const interviewEvalCases: InterviewEvalCase[] = [
  passingInterview,
  ...rubricFailureCases,
];
