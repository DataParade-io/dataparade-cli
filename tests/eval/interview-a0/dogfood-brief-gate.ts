/**
 * Brief gate for dogfood-brief-a0.md @ 16f2e857a47d54bfea6ca5d7f23a6c4f2732da29.
 * Land eligibility is brief-driven — not frozen discovery ids forever.
 */
import { PINNED_BRIEF_SHA } from "./pins";

export interface DogfoodBriefGate {
  brief_sha: string;
  unknown_slots: Set<string>;
  partial_known_actors: Set<string>;
  scan_known_flows: Set<string>;
  taxonomy: {
    actorKinds: string[];
    dataCategories: string[];
    purposes: string[];
  };
}

export const DOGFOOD_BRIEF_GATE: DogfoodBriefGate = {
  brief_sha: PINNED_BRIEF_SHA,
  unknown_slots: new Set(["system_identity"]),
  partial_known_actors: new Set(["cmp_6", "cmp_17", "cmp_20", "cmp_25"]),
  scan_known_flows: new Set([
    "flow_289",
    "flow_109",
    "flow_106",
    "flow_254",
    "flow_111",
    "flow_103",
    "flow_10",
    "flow_14",
    "flow_20",
    "flow_267",
    "flow_268",
    "flow_287",
    "flow_269",
    "flow_279",
    "flow_288",
    "flow_290",
    "flow_291",
    "flow_24",
    "flow_61",
    "flow_1",
  ]),
  taxonomy: {
    actorKinds: ["person", "role", "persona"],
    dataCategories: [
      "personal",
      "identifiers",
      "contact",
      "demographic",
      "credentials",
      "financial",
      "health",
      "location",
      "communications",
      "commercial",
      "other",
    ],
    purposes: [
      "service_provision",
      "analytics",
      "marketing",
      "security",
      "legal_obligation",
      "research",
      "debugging",
      "unspecified",
    ],
  },
};

export const SHAPE_TO_SLOT: Record<"D2" | "D4" | "D7" | "D8", string> = {
  D2: "in_scope",
  D4: "actor_kind",
  D7: "data_categories",
  D8: "purpose",
};
