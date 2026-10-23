import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";

import { applyAnswers } from "../facts/apply-answers";
import { appendAnswers } from "../facts/io";
import type { Answer } from "../facts/schema";
import { readKbBrief } from "./brief";
import { KbError, loadKbState, type KbPaths } from "./kb-store";
import { isInterviewSlot, normalizeSlotValue, SHAPE_FOR_SLOT, SYSTEM_ASSERTS_URI, type InterviewSlot } from "./slot-shapes";

/** Write-back rules §7: the reviewer is a person, never a model, agent, or automated pass. */
const AUTO_REVIEWER_RE = /^(gpt|claude|composer|model|agent|auto|rubric|the room|coding agent)/i;
/** Eval artifacts and mapped/scripted transcripts are never landable evidence. */
const REJECTED_EVIDENCE_RE =
  /experiments\/datap-|\/eval\/|fixtures\/|mapped-transcript|stakeholder-script|discovery-export-bundle|raw-model-transcript/i;

export interface LandInterviewAnswerInput {
  briefSha: string;
  /** A Fact id from the brief (`flow_ab12…`), or `dp:a0/system`. */
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

export interface LandedAnswer {
  /** The id of the new entry in answers.json. */
  id: string;
  /** answers.json, or null on a dry run. */
  path: string | null;
  answer: Answer;
  /** The id of the earlier answer for the same Fact and property that this one replaces. */
  supersedes: string | null;
  dryRun: boolean;
}

export type LandedInterviewAnswer = LandedAnswer;

function newAnswerId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
  return `ans_${stamp}_${randomBytes(3).toString("hex")}`;
}

function requireHumanReviewer(reviewer: string): string {
  const value = reviewer.trim();
  if (!value || AUTO_REVIEWER_RE.test(value) || !value.includes("@")) {
    throw new KbError(
      "REVIEWER_NOT_HUMAN",
      `reviewer must be the developer who confirmed the answer (an email address); got '${reviewer}'.`,
    );
  }
  return value;
}

function resolveTarget(target: string, brief: ReturnType<typeof readKbBrief>, slot: InterviewSlot): string {
  if (target === SYSTEM_ASSERTS_URI) return target;
  if (brief.questions.some((q) => q.slot === slot && q.asserts === target)) return target;
  throw new KbError("NOT_ASKABLE", `${target} has no '${slot}' question in this brief; check the id against 'dataparade kb brief'.`);
}

/** The latest earlier answer for the same Fact and property. */
function previousAnswerId(answers: Answer[], factId: string, property: string | undefined): string | null {
  const earlier = answers.filter((a) => a.factId === factId && a.action === "set" && a.property === property);
  return earlier.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]?.id ?? null;
}

function store(paths: KbPaths, answer: Answer, supersedes: string | null, dryRun: boolean | undefined): LandedAnswer {
  if (!dryRun) appendAnswers(paths, [answer]);
  return { id: answer.id, path: dryRun ? null : paths.answersPath, answer, supersedes, dryRun: Boolean(dryRun) };
}

/** The slot value as answers.json keeps it: a list for data_categories, text otherwise. */
function storedSlotValue(slot: InterviewSlot, normalized: string): unknown {
  return slot === "data_categories" ? (JSON.parse(normalized) as string[]) : normalized;
}

/**
 * Land one developer-confirmed interview answer in answers.json (`source=interview`).
 * Every check from the write-back rules runs here so an agent can't land an invented
 * value, an unconfirmed answer, or a fact the scan owns.
 */
export function landInterviewAnswer(paths: KbPaths, input: LandInterviewAnswerInput): LandedAnswer {
  if (!isInterviewSlot(input.slot)) {
    throw new KbError(
      "SLOT_NOT_LANDABLE",
      `'${input.slot}' can't land from an interview. Landable slots: ${Object.keys(SHAPE_FOR_SLOT).join(", ")}. Scan-asserted facts (names, endpoints, merges) need a human review instead (kb land --source review).`,
    );
  }
  const slot = input.slot;
  const brief = readKbBrief(paths, input.briefSha);
  const factId = resolveTarget(input.target, brief, slot);
  const value = normalizeSlotValue(slot, input.value);
  const reviewer = requireHumanReviewer(input.reviewer);
  if (!/^[0-9a-f]{40}$/.test(input.skillSha)) {
    throw new KbError("BAD_SKILL_SHA", `skill SHA must be 40 hex characters; got '${input.skillSha}'.`);
  }
  const evidencePath = path.resolve(paths.dir, input.evidence);
  if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
    throw new KbError("NO_EVIDENCE", `Evidence transcript not found: ${evidencePath}`);
  }
  const evidenceRef = path.relative(paths.dir, evidencePath).split(path.sep).join("/");
  if (REJECTED_EVIDENCE_RE.test(evidenceRef)) {
    throw new KbError("EVIDENCE_NOT_LANDABLE", `Eval or scripted transcripts can't be landing evidence: ${evidenceRef}`);
  }

  const state = loadKbState(paths);
  const now = input.now ?? new Date();
  const answer: Answer = {
    id: newAnswerId(now),
    factId,
    action: "set",
    property: slot,
    value: storedSlotValue(slot, value),
    by: reviewer,
    at: now.toISOString(),
    source: "interview",
    evidence: evidenceRef,
    briefSha: input.briefSha,
    skillSha: input.skillSha,
  };
  return store(paths, answer, previousAnswerId(state.answers, factId, slot), input.dryRun);
}

export interface LandReviewAnswerInput {
  /** The Fact the decision is about (a component, flow, data item, group or occurrence id). */
  target: string;
  action: "set" | "remove";
  /** For `set`: the property to override. */
  property?: string;
  /** For `set`: the new value. A value starting with `[` or `{` is read as JSON, anything else is text. */
  value?: string;
  reviewer: string;
  /** Why: a note, a link, or a path relative to the KB root. */
  evidence?: string;
  now?: Date;
  dryRun?: boolean;
}

function parseReviewValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      throw new KbError("BAD_VALUE", `value looks like JSON but does not parse: ${value}`);
    }
  }
  return value;
}

/**
 * Land a reviewer's decision about a scan Fact: override one property (`set`) or drop the
 * Fact (`remove`). Interview answers go through {@link landInterviewAnswer} instead.
 */
export function landReviewAnswer(paths: KbPaths, input: LandReviewAnswerInput): LandedAnswer {
  const reviewer = requireHumanReviewer(input.reviewer);
  if (input.action === "set" && (!input.property || input.value === undefined)) {
    throw new KbError("BAD_ANSWER", "a 'set' answer needs both a property and a value.");
  }
  if (input.action === "remove" && (input.property || input.value !== undefined)) {
    throw new KbError("BAD_ANSWER", "a 'remove' answer takes no property or value.");
  }
  const state = loadKbState(paths);
  const now = input.now ?? new Date();
  const answer: Answer = {
    id: newAnswerId(now),
    factId: input.target,
    action: input.action,
    ...(input.action === "set" ? { property: input.property, value: parseReviewValue(input.value ?? "") } : {}),
    by: reviewer,
    at: now.toISOString(),
    source: "review",
    ...(input.evidence ? { evidence: input.evidence } : {}),
  };
  const trial = applyAnswers(state.facts, state.dataItemFiles, [answer]);
  if (trial.orphans.length > 0) {
    throw new KbError("NO_SUCH_FACT", `${input.target} is not a Fact in this scan. Check the id in facts.json or the data item file.`);
  }
  if (trial.ignored.length > 0) {
    throw new KbError("NOT_LANDABLE", `'${input.property ?? "remove"}' can't be changed on ${input.target}.`);
  }
  return store(paths, answer, input.action === "set" ? previousAnswerId(state.answers, input.target, input.property) : null, input.dryRun);
}
