import { fingerprintOf, type Fingerprint } from "@dataparade/kb-compare";
import { PROJECT_NAME_KEY_TOKEN } from "@dataparade/scanner";

import { readAnswers, writeAnswers } from "../facts/io";
import type { Answer, FactsFile } from "../facts/schema";
import { readKbBrief, type KbBrief } from "./brief";
import { KbError, loadKbState, type KbPaths } from "./kb-store";
import { SYSTEM_ASSERTS_URI } from "./slot-shapes";

/**
 * Identity keys and evidence fingerprints on answers (DATAP-873).
 *
 * Each answer records the identity key of its element and the element's fingerprint at the
 * time of the answer, so the slot rules (DATAP-874) can find the element in a later scan and
 * decide whether the answer still holds. Answers about the whole system (`dp:a0/system`) keep
 * that URI as their key and have no fingerprint: no element change can make them stale.
 */

export type AnswerSubject = Fingerprint["subject"];

export interface AnswerElement {
  subject: AnswerSubject;
  key: string;
}

/** The element a Fact id names in a scan, by its identity. Null when the scan has no such Fact or it has no identity. */
export function elementOfFact(facts: FactsFile, factId: string): AnswerElement | null {
  for (const c of facts.components) {
    if (c.id === factId && c.identity) return { subject: "component", key: c.identity.key };
  }
  for (const f of facts.dataFlows) {
    if (f.id === factId && f.identity) return { subject: "dataFlow", key: f.identity.key };
  }
  for (const item of facts.dataItems) {
    if (item.id === factId && item.identity) return { subject: "dataItem", key: item.identity.key };
    for (const g of item.groups) {
      if (g.id === factId && g.identity) return { subject: "group", key: g.identity.key };
    }
  }
  return null;
}

/** Identity key and fingerprint fields for an answer about `factId`, from the scan it was given against. */
export function fingerprintFields(
  facts: FactsFile,
  factId: string,
): Pick<Answer, "identityKey" | "fingerprint" | "fingerprintSource"> {
  if (factId === SYSTEM_ASSERTS_URI) {
    return { identityKey: SYSTEM_ASSERTS_URI, fingerprintSource: "landed" };
  }
  const element = elementOfFact(facts, factId);
  if (!element) return {};
  const fingerprint = fingerprintOf(facts, element.subject, element.key);
  return {
    identityKey: element.key,
    ...(fingerprint ? { fingerprint } : {}),
    fingerprintSource: "landed",
  };
}

/** The element the brief recorded for a Fact id: a component (actor, external system, flow endpoint) or a flow. */
function elementFromBrief(brief: KbBrief, factId: string): AnswerElement | null {
  for (const flow of brief.flows) {
    if ((flow.id === factId || flow.asserts === factId) && flow.identity) {
      return { subject: "dataFlow", key: flow.identity.key };
    }
  }
  const entities = [
    ...brief.actors,
    ...brief.external_systems,
    ...brief.flows.flatMap((flow) => [flow.source, flow.target]),
  ];
  for (const entity of entities) {
    if ((entity.id === factId || entity.asserts === factId) && entity.identity) {
      return { subject: "component", key: entity.identity.key };
    }
  }
  return null;
}

/** The root Application of a scan: the component keyed by the project-name token (DATAP-858). */
function rootApplicationKey(facts: FactsFile): string | null {
  const roots = facts.components.filter((c) => c.identity?.key.endsWith(`|${PROJECT_NAME_KEY_TOKEN}`));
  return roots.length === 1 ? roots[0]!.identity!.key : null;
}

/** An `app:` key with its name segment swapped for the project-name token. */
function withProjectNameToken(key: string): string | null {
  if (!key.startsWith("app:")) return null;
  const at = key.lastIndexOf("|");
  return at === -1 ? null : `${key.slice(0, at)}|${PROJECT_NAME_KEY_TOKEN}`;
}

/** The brief's entity name for a Fact id, when the brief names it. */
function briefEntityName(brief: KbBrief, factId: string): string | null {
  const entities = [...brief.actors, ...brief.external_systems, ...brief.flows.flatMap((f) => [f.source, f.target])];
  return entities.find((e) => e.id === factId || e.asserts === factId)?.name ?? null;
}

export type MigrationOutcome = "brief" | "scan" | "root" | "system" | "unresolved";

export interface MigrateFingerprintsResult {
  /** Answers given an identity key (and a fingerprint where the element is in the current scan). */
  migrated: number;
  /** Answers that already had an identity key. */
  alreadyKeyed: number;
  /** How each migrated or unresolved answer found its element, by answer id. */
  outcomes: Record<string, MigrationOutcome>;
  /** Answers with a key whose element is not in the current scan: they keep the key and have no fingerprint. */
  withoutFingerprint: string[];
  /** Answers no brief or scan could key. */
  unresolved: string[];
  dryRun: boolean;
}

/**
 * Give each answer without an identity key its key and a fingerprint (`fingerprintSource:
 * migrated`). The key comes from the brief the answer cites; failing that, from the Fact with
 * the same id in the current scan; failing that, for the root Application whose id changed
 * once (DATAP-858), from the project-name token. The fingerprint is computed from the current
 * scan. Answers on occurrences stay unkeyed: they are outside the carry rules (DATAP-862).
 */
export function migrateAnswerFingerprints(paths: KbPaths, options: { dryRun?: boolean } = {}): MigrateFingerprintsResult {
  const state = loadKbState(paths);
  const file = readAnswers(paths);
  const facts = state.facts;
  const root = rootApplicationKey(facts);
  const briefs = new Map<string, KbBrief | null>();
  const briefFor = (sha: string | undefined): KbBrief | null => {
    if (!sha) return null;
    if (!briefs.has(sha)) {
      try {
        briefs.set(sha, readKbBrief(paths, sha));
      } catch (error) {
        if (!(error instanceof KbError)) throw error;
        briefs.set(sha, null);
      }
    }
    return briefs.get(sha) ?? null;
  };

  const result: MigrateFingerprintsResult = {
    migrated: 0,
    alreadyKeyed: 0,
    outcomes: {},
    withoutFingerprint: [],
    unresolved: [],
    dryRun: Boolean(options.dryRun),
  };

  const next = file.answers.map((answer): Answer => {
    if (answer.identityKey) {
      result.alreadyKeyed += 1;
      return answer;
    }
    if (answer.factId === SYSTEM_ASSERTS_URI) {
      result.migrated += 1;
      result.outcomes[answer.id] = "system";
      return { ...answer, identityKey: SYSTEM_ASSERTS_URI, fingerprintSource: "migrated" };
    }

    const brief = briefFor(answer.briefSha);
    let element: AnswerElement | null = brief ? elementFromBrief(brief, answer.factId) : null;
    let outcome: MigrationOutcome = element ? "brief" : "unresolved";
    if (!element) {
      element = elementOfFact(facts, answer.factId);
      if (element) outcome = "scan";
    }
    if (element?.subject === "component" && root && !fingerprintOf(facts, "component", element.key)) {
      // A brief key from before DATAP-858 names the root by its folder; the scan now uses the token.
      if (withProjectNameToken(element.key) === root) {
        element = { subject: "component", key: root };
        outcome = "root";
      }
    }
    if (!element && brief && root) {
      // A brief without identities (CLI 0.0.32 and earlier) that names the root Application.
      const rootFact = facts.components.find((c) => c.identity?.key === root);
      if (rootFact && briefEntityName(brief, answer.factId) === rootFact.name) {
        element = { subject: "component", key: root };
        outcome = "root";
      }
    }
    if (!element) {
      result.unresolved.push(answer.id);
      result.outcomes[answer.id] = "unresolved";
      return answer;
    }

    result.migrated += 1;
    result.outcomes[answer.id] = outcome;
    const fingerprint = fingerprintOf(facts, element.subject, element.key);
    if (!fingerprint) result.withoutFingerprint.push(answer.id);
    return {
      ...answer,
      identityKey: element.key,
      ...(fingerprint ? { fingerprint } : {}),
      fingerprintSource: "migrated",
    };
  });

  if (!options.dryRun && result.migrated > 0) {
    writeAnswers(paths, { ...file, answers: next });
  }
  return result;
}
