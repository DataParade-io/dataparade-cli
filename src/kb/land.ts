import fs from "fs";
import path from "path";

import {
  OCSF_ARCHITECTURE_CATEGORY_UID,
  OCSF_ARCHITECTURE_DISCOVERY_CLASS_UID,
  OCSF_ARCHITECTURE_DISCOVERY_TYPE_UID,
  PINNED_OCSF_BASE_VERSION,
  PINNED_OCSF_EXTENSION_NAME,
  PINNED_OCSF_EXTENSION_VERSION,
} from "../discoveries/contract/ocsf-pins";
import type { OcsfDiscoveryRecord } from "../discoveries/contract/ocsf-discovery-record";
import { PINNED_ONTOLOGY_VERSION } from "../discoveries/contract/ontology-pins";
import { parseScanEntityAsserts } from "../discoveries/scan-entity-uri";
import { slugifyDiscoveryId, writeOcsfDiscoveryRecordsToDir } from "../discoveries/write-ocsf-discoveries";
import { readKbBrief } from "./brief";
import { KbError, loadKbRecords, type KbPaths } from "./kb-store";
import { isInterviewSlot, normalizeSlotValue, SHAPE_FOR_SLOT, SYSTEM_ASSERTS_URI, type InterviewSlot } from "./slot-shapes";

/** Write-back rules §7: the reviewer is a person, never a model, agent, or automated pass. */
const AUTO_REVIEWER_RE = /^(gpt|claude|composer|model|agent|auto|rubric|the room|coding agent)/i;
/** Eval artifacts and mapped/scripted transcripts are never landable evidence. */
const REJECTED_EVIDENCE_RE =
  /experiments\/datap-|\/eval\/|fixtures\/|mapped-transcript|stakeholder-script|discovery-export-bundle|raw-model-transcript/i;

export interface LandInterviewAnswerInput {
  briefSha: string;
  /** A scan entity URI from the brief, a bare entity id (`flow_ab12…`), or `dp:a0/system`. */
  target: string;
  slot: string;
  value: string;
  /** The developer who confirmed the answer (their email). */
  reviewer: string;
  /** Unedited interview transcript, absolute or relative to the KB root. */
  evidence: string;
  /** Full SHA of the interview skill that asked the question (e.g. `git hash-object SKILL.md`). */
  skillSha: string;
  now?: Date;
  dryRun?: boolean;
}

export interface LandedInterviewAnswer {
  uid: string;
  path: string | null;
  asserts: string;
  slot: InterviewSlot;
  value: string;
  supersedes: string | null;
  dryRun: boolean;
}

function resolveTarget(target: string, brief: ReturnType<typeof readKbBrief>, slot: InterviewSlot): string {
  if (target === SYSTEM_ASSERTS_URI || target.startsWith("dp:")) return target;
  const matches = brief.questions.filter(
    (q) => q.slot === slot && q.asserts !== SYSTEM_ASSERTS_URI && parseScanEntityAsserts(q.asserts)?.entityId === target,
  );
  if (matches.length === 1) return matches[0].asserts;
  if (matches.length > 1) {
    throw new KbError("AMBIGUOUS_TARGET", `${target} exists under several scan paths; pass the full asserts URI from the brief.`);
  }
  throw new KbError("NOT_ASKABLE", `${target} has no '${slot}' question in this brief; check the id against 'dataparade kb brief'.`);
}

function landDate(now: Date): string {
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Land one confirmed interview answer as an OCSF Architecture Discovery
 * (`source=interview`). Every check from the write-back rules runs here so an
 * agent can't land an invented value, an unconfirmed answer, or a fact the
 * scan owns.
 */
export function landInterviewAnswer(paths: KbPaths, input: LandInterviewAnswerInput): LandedInterviewAnswer {
  if (!isInterviewSlot(input.slot)) {
    throw new KbError(
      "SLOT_NOT_LANDABLE",
      `'${input.slot}' can't land from an interview. Landable slots: ${Object.keys(SHAPE_FOR_SLOT).join(", ")}. Scan-asserted facts (names, endpoints, merges) need a human override instead.`,
    );
  }
  const slot = input.slot;
  const brief = readKbBrief(paths, input.briefSha);
  const asserts = resolveTarget(input.target, brief, slot);
  if (!brief.questions.some((q) => q.asserts === asserts && q.slot === slot)) {
    throw new KbError("NOT_ASKABLE", `Brief ${input.briefSha} has no '${slot}' question for ${asserts}.`);
  }
  const value = normalizeSlotValue(slot, input.value);

  const reviewer = input.reviewer.trim();
  if (!reviewer || AUTO_REVIEWER_RE.test(reviewer) || !reviewer.includes("@")) {
    throw new KbError(
      "REVIEWER_NOT_HUMAN",
      `reviewer must be the developer who confirmed the answer (an email address); got '${input.reviewer}'.`,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(input.skillSha)) {
    throw new KbError("BAD_SKILL_SHA", `skill SHA must be 40 hex characters; got '${input.skillSha}'.`);
  }
  const evidencePath = path.resolve(paths.root, input.evidence);
  if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
    throw new KbError("NO_EVIDENCE", `Evidence transcript not found: ${evidencePath}`);
  }
  const evidenceRef = path.relative(paths.root, evidencePath).split(path.sep).join("/");
  if (REJECTED_EVIDENCE_RE.test(evidenceRef)) {
    throw new KbError("EVIDENCE_NOT_LANDABLE", `Eval or scripted transcripts can't be landing evidence: ${evidenceRef}`);
  }

  // A correction supersedes the latest earlier answer for the same slot.
  const existing = loadKbRecords(paths).filter(
    (r) => r.dataparade.source === "interview" && r.dataparade.asserts === asserts && r.dataparade.asserted_slot === slot,
  );
  const supersededUids = new Set(existing.map((r) => r.dataparade.supersedes).filter(Boolean));
  const current = existing
    .filter((r) => !supersededUids.has(r.metadata.uid))
    .sort((a, b) => Date.parse(b.dataparade.asserted_at) - Date.parse(a.dataparade.asserted_at))[0];

  const now = input.now ?? new Date();
  const assertedAt = now.toISOString();
  const baseUid = `dp:discovery/interview/${slugifyDiscoveryId(asserts)}/${slot}/${landDate(now)}`;
  const takenUids = new Set(existing.map((r) => r.metadata.uid));
  let uid = baseUid;
  for (let n = 2; takenUids.has(uid); n++) uid = `${baseUid}-${n}`;

  const parsed = parseScanEntityAsserts(asserts);
  const record: OcsfDiscoveryRecord = {
    class_name: "Architecture Discovery",
    class_uid: OCSF_ARCHITECTURE_DISCOVERY_CLASS_UID,
    category_name: "Architecture",
    category_uid: OCSF_ARCHITECTURE_CATEGORY_UID,
    activity_id: 1,
    activity_name: "Create",
    type_uid: OCSF_ARCHITECTURE_DISCOVERY_TYPE_UID,
    time: Math.floor(now.getTime() / 1000),
    metadata: {
      version: PINNED_OCSF_BASE_VERSION,
      uid,
      extension: { name: PINNED_OCSF_EXTENSION_NAME, version: PINNED_OCSF_EXTENSION_VERSION },
      product: { name: "dataparade-cli", vendor_name: "DataParade" },
      profiles: ["architecture_privacy"],
    },
    resources: [
      {
        uid: asserts,
        name: parsed?.entityId ?? asserts,
        type: asserts === SYSTEM_ASSERTS_URI ? "system" : "entity",
      },
    ],
    dataparade: {
      record_kind: "discovery",
      ontology_version: PINNED_ONTOLOGY_VERSION,
      source: "interview",
      asserted_at: assertedAt,
      asserts,
      asserted_slot: slot,
      asserted_value: value,
      eligible_shape: SHAPE_FOR_SLOT[slot].shape,
      raw_evidence_ref: evidenceRef,
      reviewer,
      reviewed_at: assertedAt,
      brief_sha: input.briefSha,
      skill_sha: input.skillSha,
      ...(current ? { supersedes: current.metadata.uid } : {}),
      ...(parsed ? { related_resource_refs: [parsed.entityId] } : {}),
    },
  };

  const written = input.dryRun ? [] : writeOcsfDiscoveryRecordsToDir([record], paths.discoveriesDir);
  return {
    uid,
    path: written[0] ?? null,
    asserts,
    slot,
    value,
    supersedes: current?.metadata.uid ?? null,
    dryRun: Boolean(input.dryRun),
  };
}
