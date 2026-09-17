import {
  PINNED_BRIEF_SHA,
  PINNED_ONTOLOGY_SHA,
  PINNED_ONTOLOGY_TAG,
  PINNED_ONTOLOGY_VERSION,
  PINNED_SKILL_SHA,
} from "./pins";
import type {
  EligibleInterviewShape,
  InterviewDiscoveryExport,
  InterviewDiscoveryRecord,
  InterviewDiscoveryRefusal,
  InterviewDiscoveryRefusalCode,
} from "./discovery-export-types";
import { interviewDiscoveryExportSchema } from "./discovery-export-types";
import type { BriefSnapshot, InterviewAction, SimulatedInterview } from "./types";

const FROZEN_SCRIPTED_EXAM_RE = /datap-67[346]/i;
const SYSTEM_ASSERTS_URI = "dp:a0/system";

const AUTO_REVIEWER_RE =
  /^(gpt|claude|composer|model|agent|auto|rubric|the room|coding agent)/i;

interface PartialInterviewDiscovery {
  eligible_shape: EligibleInterviewShape;
  asserted_slot: string;
  asserted_value: string;
  asserts: string;
}

export interface ExportInterviewDiscoveriesOptions {
  brief?: BriefSnapshot;
  briefSha?: string;
  skillSha?: string;
  assertedAt?: string;
  /** Unedited transcript / notes pointer — not mapper-only JSON. */
  rawEvidenceRef?: string;
  /** Caller-supplied human reviewer only — never invented by the adapter. */
  reviewer?: string;
  reviewedAt?: string;
}

function entityUri(discoveryId: string): string {
  return `dp:scan/entity/${discoveryId}`;
}

function discoveryUri(asserts: string, slot: string, actionIndex: number): string {
  const subject = asserts.replace(/[:/]/g, "_");
  return `dp:discovery/interview/${subject}/${slot}/${actionIndex}`;
}

function isFrozenScriptedExam(interview: SimulatedInterview): boolean {
  return (
    FROZEN_SCRIPTED_EXAM_RE.test(interview.id) ||
    FROZEN_SCRIPTED_EXAM_RE.test(interview.description)
  );
}

function isScanKnownComponent(brief: BriefSnapshot, id: string): boolean {
  return brief.scanKnownComponents.includes(id);
}

function isPartialKnownActor(brief: BriefSnapshot, id: string): boolean {
  return brief.partialKnownActors.includes(id);
}

function isMushMergeWrite(action: InterviewAction): boolean {
  if (typeof action.value === "string" && action.value.startsWith("merged:")) {
    return true;
  }
  return false;
}

function refusesReviewer(reviewer: string | undefined): string | undefined {
  if (!reviewer?.trim()) {
    return undefined;
  }
  const trimmed = reviewer.trim();
  if (AUTO_REVIEWER_RE.test(trimmed)) {
    throw new Error(
      `Reviewer '${trimmed}' is not a human id — omit reviewer or supply a caller-provided human identifier`,
    );
  }
  return trimmed;
}

function refuse(
  actionIndex: number,
  code: InterviewDiscoveryRefusalCode,
  message: string,
): InterviewDiscoveryRefusal {
  return { action_index: actionIndex, code, message };
}

function evaluateWriteAction(
  action: InterviewAction,
  actionIndex: number,
  brief: BriefSnapshot,
): { record?: PartialInterviewDiscovery; refusal?: InterviewDiscoveryRefusal } {
  if (action.kind !== "write") {
    return {
      refusal: refuse(
        actionIndex,
        "NOT_INTERVIEW_WRITE",
        `Action kind '${action.kind}' is not an interview write export`,
      ),
    };
  }

  if (isMushMergeWrite(action)) {
    return {
      refusal: refuse(
        actionIndex,
        "MUSH_MERGE",
        "Mush merge writes are not exportable interview Discoveries",
      ),
    };
  }

  if (action.provenance !== "interview") {
    return {
      refusal: refuse(
        actionIndex,
        "NOT_INTERVIEW_WRITE",
        `Write on ${action.slot} lacks provenance=interview`,
      ),
    };
  }

  if (action.slot === "system_boundary") {
    return {
      refusal: refuse(actionIndex, "D9_BOUNDARY", "System boundary writes are refused (D9)"),
    };
  }

  if (action.slot === "sends_data_to.endpoint") {
    return {
      refusal: refuse(
        actionIndex,
        "D6_ENDPOINT_REASK",
        "Flow endpoint identity is scan-known — cannot export interview overwrite (D6)",
      ),
    };
  }

  if (action.slot === "external_systems") {
    const id = action.discoveryId;
    if (id && isScanKnownComponent(brief, id)) {
      return {
        refusal: refuse(
          actionIndex,
          "D5_IDENTITY_REWRITE",
          `ExternalSystem ${id} identity is scan-backed (D5)`,
        ),
      };
    }
    return {
      refusal: refuse(
        actionIndex,
        "INELIGIBLE_SLOT",
        "external_systems slot is not an eligible interview Discovery shape",
      ),
    };
  }

  if (action.slot === "actors") {
    const id = action.discoveryId;
    if (!id) {
      return {
        refusal: refuse(actionIndex, "INVALID_SHAPE", "Actor write requires discoveryId"),
      };
    }
    if (isScanKnownComponent(brief, id) && !isPartialKnownActor(brief, id)) {
      return {
        refusal: refuse(
          actionIndex,
          "SCAN_WINS",
          `Actor ${id} is scan-known and not partial-known — interview cannot rewrite identity`,
        ),
      };
    }
    if (!isPartialKnownActor(brief, id)) {
      return {
        refusal: refuse(
          actionIndex,
          "D5_IDENTITY_REWRITE",
          `Actor ${id} is not a partial-known interview target (D5)`,
        ),
      };
    }
    if (typeof action.value !== "string" || !brief.taxonomy.actorKinds.includes(action.value)) {
      return {
        refusal: refuse(
          actionIndex,
          "INVALID_SHAPE",
          "ActorKind write must be exactly one ontology enum token (D4)",
        ),
      };
    }
    return {
      record: {
        eligible_shape: "D4",
        asserted_slot: "actor_kind",
        asserted_value: action.value,
        asserts: entityUri(id),
      },
    };
  }

  if (action.slot === "sends_data_to.data_categories") {
    const id = action.discoveryId;
    if (!id) {
      return {
        refusal: refuse(actionIndex, "INVALID_SHAPE", "Flow category write requires discoveryId"),
      };
    }
    if (!brief.scanKnownFlows.includes(id)) {
      return {
        refusal: refuse(
          actionIndex,
          "D6_ENDPOINT_REASK",
          `Flow ${id} is not a scan-known endpoint row (D6)`,
        ),
      };
    }
    const values = Array.isArray(action.value) ? action.value : [action.value];
    if (!values.every((v) => typeof v === "string" && brief.taxonomy.dataCategories.includes(v))) {
      return {
        refusal: refuse(
          actionIndex,
          "INVALID_SHAPE",
          "data_categories must be ontology enum list (D7)",
        ),
      };
    }
    return {
      record: {
        eligible_shape: "D7",
        asserted_slot: "data_categories",
        asserted_value: JSON.stringify(values),
        asserts: entityUri(id),
      },
    };
  }

  if (action.slot === "sends_data_to.purpose") {
    const id = action.discoveryId;
    if (!id) {
      return {
        refusal: refuse(actionIndex, "INVALID_SHAPE", "Flow purpose write requires discoveryId"),
      };
    }
    if (!brief.scanKnownFlows.includes(id)) {
      return {
        refusal: refuse(
          actionIndex,
          "D6_ENDPOINT_REASK",
          `Flow ${id} is not a scan-known endpoint row (D6)`,
        ),
      };
    }
    if (typeof action.value !== "string" || !brief.taxonomy.purposes.includes(action.value)) {
      return {
        refusal: refuse(
          actionIndex,
          "INVALID_SHAPE",
          "purpose must be a single ontology enum token (D8)",
        ),
      };
    }
    return {
      record: {
        eligible_shape: "D8",
        asserted_slot: "purpose",
        asserted_value: action.value,
        asserts: entityUri(id),
      },
    };
  }

  if (action.slot === "system_identity") {
    if (!brief.unknownSlots.includes("system_identity")) {
      return {
        refusal: refuse(
          actionIndex,
          "SCAN_WINS",
          "System identity is not brief-unknown — scan/doc wins",
        ),
      };
    }
    if (typeof action.value !== "string" || action.value.trim().length === 0) {
      return {
        refusal: refuse(
          actionIndex,
          "INVALID_SHAPE",
          "System identity write requires approved text (D2)",
        ),
      };
    }
    return {
      record: {
        eligible_shape: "D2",
        asserted_slot: "in_scope",
        asserted_value: action.value.trim(),
        asserts: SYSTEM_ASSERTS_URI,
      },
    };
  }

  return {
    refusal: refuse(
      actionIndex,
      "INELIGIBLE_SLOT",
      `Slot ${action.slot} is out of A0 interview Discovery export scope`,
    ),
  };
}

function buildRecord(
  partial: PartialInterviewDiscovery,
  actionIndex: number,
  interview: SimulatedInterview,
  options: ExportInterviewDiscoveriesOptions,
  briefSha: string,
  skillSha: string,
  assertedAt: string,
  reviewer?: string,
  reviewedAt?: string,
): InterviewDiscoveryRecord {
  const rawEvidenceRef =
    options.rawEvidenceRef ?? `interview:${interview.id}:action:${actionIndex}`;

  const record: InterviewDiscoveryRecord = {
    id: discoveryUri(partial.asserts, partial.asserted_slot, actionIndex),
    class: "Discovery",
    source: "interview",
    asserted_at: assertedAt,
    asserts: partial.asserts,
    asserted_slot: partial.asserted_slot,
    asserted_value: partial.asserted_value,
    eligible_shape: partial.eligible_shape,
    raw_evidence_ref: rawEvidenceRef,
    brief_sha: briefSha,
    skill_sha: skillSha,
  };

  if (reviewer) {
    record.reviewer = reviewer;
    if (reviewedAt) {
      record.reviewed_at = reviewedAt;
    }
  }

  return record;
}

/**
 * Export ontology interview Discoveries from eval interview writes (pinned in pins.ts).
 *
 * Adapter only — `landable` is always false. Never auto-promotes frozen scripted
 * exams (datap-673/674/676). Does not rename eval actions or mint scan/cloud source.
 */
export function exportInterviewDiscoveries(
  interview: SimulatedInterview,
  options: ExportInterviewDiscoveriesOptions = {},
): InterviewDiscoveryExport {
  const brief = options.brief;
  if (!brief) {
    throw new Error("exportInterviewDiscoveries requires brief snapshot");
  }

  const briefSha = options.briefSha ?? PINNED_BRIEF_SHA;
  const skillSha = options.skillSha ?? PINNED_SKILL_SHA;
  const assertedAt = options.assertedAt ?? new Date().toISOString();
  const reviewer = refusesReviewer(options.reviewer);

  const promotionBlocked = isFrozenScriptedExam(interview);
  const discoveries: InterviewDiscoveryRecord[] = [];
  const refused: InterviewDiscoveryRefusal[] = [];

  if (promotionBlocked) {
    refused.push(
      refuse(
        0,
        "FROZEN_SCRIPTED_EXAM",
        "Frozen scripted exam artifacts (datap-673/674/676) are not exportable for land promotion",
      ),
    );
    const blocked: InterviewDiscoveryExport = {
      export_kind: "interview_discovery_bundle",
      surface: "a0-data-flow",
      ontology_version: PINNED_ONTOLOGY_VERSION,
      ontology_tag: PINNED_ONTOLOGY_TAG,
      ontology_sha: PINNED_ONTOLOGY_SHA,
      write_back_kb_sha: PINNED_SKILL_SHA,
      adapter_only: true,
      landable: false,
      promotion_blocked: true,
      promotion_block_reason: "frozen_scripted_exam",
      interview_id: interview.id,
      discoveries: [],
      refused,
    };
    return interviewDiscoveryExportSchema.parse(blocked);
  }

  interview.actions.forEach((action, actionIndex) => {
    const result = evaluateWriteAction(action, actionIndex, brief);
    if (result.refusal) {
      refused.push(result.refusal);
      return;
    }
    if (!result.record) {
      return;
    }
    discoveries.push(
      buildRecord(
        result.record,
        actionIndex,
        interview,
        options,
        briefSha,
        skillSha,
        assertedAt,
        reviewer,
        options.reviewedAt,
      ),
    );
  });

  const exportBundle: InterviewDiscoveryExport = {
    export_kind: "interview_discovery_bundle",
    surface: "a0-data-flow",
    ontology_version: PINNED_ONTOLOGY_VERSION,
    ontology_tag: PINNED_ONTOLOGY_TAG,
    ontology_sha: PINNED_ONTOLOGY_SHA,
    write_back_kb_sha: PINNED_SKILL_SHA,
    adapter_only: true,
    landable: false,
    promotion_blocked: false,
    interview_id: interview.id,
    discoveries,
    refused,
  };

  return interviewDiscoveryExportSchema.parse(exportBundle);
}
