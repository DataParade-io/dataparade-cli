import { createHash } from "crypto";
import fs from "fs";
import path from "path";

import type { A0DiscoveriesDocument } from "../discoveries/contract/discoveries-document.schema";
import { PINNED_ONTOLOGY_VERSION } from "../discoveries/contract/ontology-pins";
import { ensureDir, KbError, loadKbState, type KbPaths } from "./kb-store";
import { SHAPE_FOR_SLOT, SYSTEM_ASSERTS_URI, type EligibleShape, type InterviewSlot } from "./slot-shapes";

/**
 * A KB brief is a snapshot of what the knowledge base knows and what an
 * interview may ask, generated from facts.json, the data item files and answers.json. It replaces the
 * hand-pinned dogfood brief for live sessions: its content SHA is the
 * `brief_sha` every answer cites, and the file stays in `<kb>/briefs/` so that
 * provenance resolves to the exact state the question was asked from.
 */
export interface KbBriefEntity {
  id: string;
  asserts: string;
  name: string;
  type: string;
}

export type FlowCrossing = "outbound_third_party" | "from_actor" | "internal";

export interface KbBriefFlow {
  id: string;
  asserts: string;
  type: string;
  crossing: FlowCrossing;
  source: KbBriefEntity;
  target: KbBriefEntity;
  data_categories: string[] | null;
  purpose: string | null;
}

export interface KbBriefQuestion {
  asserts: string;
  slot: InterviewSlot;
  shape: EligibleShape;
  status: "unknown" | "answered";
  about: string;
}

export interface KbBrief {
  kind: "dataparade_kb_brief";
  version: 1;
  ontology_version: string;
  system: { asserts: string; in_scope: string | null };
  actors: Array<KbBriefEntity & { actor_kind: string | null }>;
  external_systems: KbBriefEntity[];
  flows: KbBriefFlow[];
  /** Interview order: scope, outbound third-party flows, then people (no internal or from-actor flow slots). */
  questions: KbBriefQuestion[];
}

const RAW_ID_SEPARATOR = "::";

function rawEntityId(projectedId: string): string {
  const at = projectedId.lastIndexOf(RAW_ID_SEPARATOR);
  return at === -1 ? projectedId : projectedId.slice(at + RAW_ID_SEPARATOR.length);
}

/** What a question is about: the Fact's id (or `dp:a0/system`). */
function entityAsserts(entity: { id: string }): string {
  return rawEntityId(entity.id);
}

export function buildKbBrief(document: A0DiscoveriesDocument): KbBrief {
  const components = new Map(document.components.map((c) => [c.id, c]));
  const brief = (c: (typeof document.components)[number]): KbBriefEntity => ({
    id: rawEntityId(c.id),
    asserts: entityAsserts(c),
    name: c.name,
    type: c.type,
  });

  const actors = document.components
    .filter((c) => c.type === "actor")
    .map((c) => ({ ...brief(c), actor_kind: c.actor_kind ?? null }));
  const externalSystems = document.components.filter((c) => c.type === "third_party").map(brief);

  const flows: KbBriefFlow[] = [];
  for (const flow of document.dataFlows) {
    const source = components.get(flow.sourceComponentId);
    const target = components.get(flow.targetComponentId);
    if (!source || !target) continue;
    const crossing: FlowCrossing =
      target.type === "third_party" && source.type !== "third_party"
        ? "outbound_third_party"
        : source.type === "actor"
          ? "from_actor"
          : "internal";
    flows.push({
      id: rawEntityId(flow.id),
      asserts: entityAsserts(flow),
      type: flow.type,
      crossing,
      source: brief(source),
      target: brief(target),
      data_categories: flow.data_categories ?? null,
      purpose: flow.purpose ?? null,
    });
  }

  const question = (asserts: string, slot: InterviewSlot, known: boolean, about: string): KbBriefQuestion => ({
    asserts,
    slot,
    shape: SHAPE_FOR_SLOT[slot].shape,
    status: known ? "answered" : "unknown",
    about,
  });

  const inScope = document.system?.in_scope ?? null;
  const questions: KbBriefQuestion[] = [
    question(SYSTEM_ASSERTS_URI, "in_scope", Boolean(inScope), "What is the system, and what is in scope?"),
  ];
  const flowQuestions = (crossing: FlowCrossing) =>
    flows
      .filter((f) => f.crossing === crossing)
      .flatMap((f) => [
        question(f.asserts, "data_categories", Boolean(f.data_categories), `What data goes from ${f.source.name} to ${f.target.name}?`),
        question(f.asserts, "purpose", Boolean(f.purpose), `Why does ${f.source.name} send data to ${f.target.name}?`),
      ]);
  questions.push(...flowQuestions("outbound_third_party"));
  questions.push(
    ...actors.map((a) => question(a.asserts, "actor_kind", Boolean(a.actor_kind), `Is "${a.name}" a specific person, a role, or a persona?`)),
  );

  return {
    kind: "dataparade_kb_brief",
    version: 1,
    ontology_version: PINNED_ONTOLOGY_VERSION,
    system: { asserts: SYSTEM_ASSERTS_URI, in_scope: inScope },
    actors,
    external_systems: externalSystems,
    flows,
    questions,
  };
}

/** Deterministic JSON (sorted keys) so the same KB state always has the same SHA. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 40-hex SHA-1 of the canonical brief: the form the ontology requires for `brief_sha`. */
export function kbBriefSha(brief: KbBrief): string {
  return createHash("sha1").update(canonicalJson(brief)).digest("hex");
}

export interface WrittenKbBrief {
  sha: string;
  path: string;
  brief: KbBrief;
  orphanCount: number;
}

/** Snapshot the current KB as a brief and store it at `<kb>/briefs/<sha>.json`. */
export function writeKbBrief(paths: KbPaths): WrittenKbBrief {
  const state = loadKbState(paths);
  const brief = buildKbBrief(state.document);
  const sha = kbBriefSha(brief);
  ensureDir(paths.briefsDir);
  const briefPath = path.join(paths.briefsDir, `${sha}.json`);
  if (!fs.existsSync(briefPath)) {
    fs.writeFileSync(briefPath, `${JSON.stringify(brief, null, 2)}\n`, "utf8");
  }
  return { sha, path: briefPath, brief, orphanCount: state.orphans.length };
}

export function readKbBrief(paths: KbPaths, sha: string): KbBrief {
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new KbError("BAD_BRIEF_SHA", `brief SHA must be 40 hex characters; got '${sha}'`);
  }
  const briefPath = path.join(paths.briefsDir, `${sha}.json`);
  if (!fs.existsSync(briefPath)) {
    throw new KbError("UNKNOWN_BRIEF", `No brief ${sha} in ${paths.briefsDir}. Run 'dataparade kb brief' and ask from that snapshot.`);
  }
  const brief = JSON.parse(fs.readFileSync(briefPath, "utf8")) as KbBrief;
  if (kbBriefSha(brief) !== sha) {
    throw new KbError("BRIEF_TAMPERED", `Brief ${sha} no longer matches its SHA; it was edited after it was written.`);
  }
  return brief;
}
