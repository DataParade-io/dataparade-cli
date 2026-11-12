import fs from "fs";
import path from "path";

import { PROJECT_NAME_KEY_TOKEN } from "@dataparade/scanner";

import { appendAnswers, readAnswers, writeFactsOutput } from "../../../src/facts/io";
import type { Answer, FactsFile, Identity } from "../../../src/facts/schema";
import { elementOfFact, fingerprintFields, migrateAnswerFingerprints } from "../../../src/kb/answer-fingerprint";
import { writeKbBrief } from "../../../src/kb/brief";
import type { KbPaths } from "../../../src/kb/kb-store";
import { landInterviewAnswer, landReviewAnswer } from "../../../src/kb/land";
import { makeKbDir, sampleFacts } from "../../helpers/facts-fixture";

const SKILL_SHA = "f".repeat(40);
const REVIEWER = "dev@example.com";

const KEYS: Record<string, string> = {
  cmp_api: "app:backend|asset|service|backend/src/main.ts|backend",
  cmp_mail: "app:<unsectioned>|third_party|email||sendgrid",
  cmp_user: "app:<unsectioned>|actor|||customer",
  flow_mail: '["flow/v1","app:backend|asset|service|backend/src/main.ts|backend","app:<unsectioned>|third_party|email||sendgrid","api_call","","",""]',
  flow_login: '["flow/v1","app:<unsectioned>|actor|||customer","app:backend|asset|service|backend/src/main.ts|backend","api_call","","",""]',
  "data_item:email": "email",
  "data_item:phone": "phone",
  "group:email:customer": "email:customer",
  "group:email:staff": "email:staff",
  "group:phone:customer": "phone:customer",
};

function identity(kind: Identity["kind"], id: string): Identity {
  return { kind, key: KEYS[id] ?? id, parts: {} };
}

/** The sample scan with identities, optionally with some ids or keys changed (a later revision). */
function keyedFacts(change: (facts: FactsFile) => void = () => {}) {
  const { facts, files } = sampleFacts();
  facts.components = facts.components.map((c) => ({ ...c, identity: identity("component", c.id) }));
  facts.dataFlows = facts.dataFlows.map((f) => ({ ...f, identity: identity("dataFlow", f.id) }));
  const keyGroups = <T extends { groups: Array<{ id: string }> }>(item: T): T => ({
    ...item,
    groups: item.groups.map((g) => ({ ...g, identity: identity("group", g.id) })),
  });
  facts.dataItems = facts.dataItems.map((item) => keyGroups({ ...item, identity: identity("dataItem", item.id) }));
  const keyedFiles = files.map((file) => keyGroups({ ...file, identity: identity("dataItem", file.id) }));
  change(facts);
  return { facts, files: keyedFiles };
}

function writeScan(paths: KbPaths, change?: (facts: FactsFile) => void): FactsFile {
  const { facts, files } = keyedFacts(change);
  writeFactsOutput(paths, facts, new Map(files.map((file) => [`data-items/${file.name}.json`, file])));
  return facts;
}

describe("answer fingerprints (DATAP-873)", () => {
  let paths: KbPaths;
  const evidence = "evidence/session.md";
  beforeEach(() => {
    paths = makeKbDir();
    fs.mkdirSync(paths.evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(paths.dir, evidence), "Q: What goes to Sendgrid?\nA: Email addresses.\n");
  });
  afterEach(() => fs.rmSync(paths.dir, { recursive: true, force: true }));

  const land = (briefSha: string, target: string, slot: string, value: string) =>
    landInterviewAnswer(paths, { briefSha, target, slot, value, reviewer: REVIEWER, evidence, skillSha: SKILL_SHA });

  it("finds a Fact's element by id across components, flows, data items and groups", () => {
    const { facts } = keyedFacts();
    expect(elementOfFact(facts, "cmp_mail")).toEqual({ subject: "component", key: KEYS.cmp_mail });
    expect(elementOfFact(facts, "flow_mail")).toEqual({ subject: "dataFlow", key: KEYS.flow_mail });
    expect(elementOfFact(facts, "data_item:email")).toEqual({ subject: "dataItem", key: "email" });
    expect(elementOfFact(facts, "group:email:staff")).toEqual({ subject: "group", key: "email:staff" });
    expect(elementOfFact(facts, "nope")).toBeNull();
  });

  it("writes the identity key and fingerprint with each new interview answer", () => {
    writeScan(paths);
    const { sha } = writeKbBrief(paths);
    const flow = land(sha, "flow_mail", "purpose", "service_provision").answer;
    expect(flow).toMatchObject({ identityKey: KEYS.flow_mail, fingerprintSource: "landed" });
    expect(flow.fingerprint).toMatchObject({
      subject: "dataFlow",
      key: KEYS.flow_mail,
      neighbours: { source: KEYS.cmp_api, target: KEYS.cmp_mail },
    });
    const actor = land(sha, "cmp_user", "actor_kind", "persona").answer;
    expect(actor.fingerprint).toMatchObject({ subject: "component", shape: { type: "actor" } });
    const system = land(sha, "dp:a0/system", "in_scope", "The web app").answer;
    expect(system).toMatchObject({ identityKey: "dp:a0/system", fingerprintSource: "landed" });
    expect(system.fingerprint).toBeUndefined();
    // Stored as landed.
    expect(readAnswers(paths).answers.every((a) => a.identityKey)).toBe(true);
  });

  it("writes them with review answers, including the groups a component handles", () => {
    writeScan(paths);
    const answer = landReviewAnswer(paths, { target: "cmp_mail", action: "set", property: "name", value: "SendGrid", reviewer: REVIEWER }).answer;
    expect(answer.identityKey).toBe(KEYS.cmp_mail);
    expect(answer.fingerprint?.handledGroups).toEqual(["email:staff"]);
  });

  it("leaves the fields out for a scan without identities", () => {
    const { facts } = sampleFacts();
    expect(fingerprintFields(facts, "cmp_mail")).toEqual({});
  });

  describe("migration of old answers", () => {
    const old = (id: string, factId: string, extra: Partial<Answer> = {}): Answer => ({
      id,
      factId,
      action: "set",
      property: "purpose",
      value: "service_provision",
      by: REVIEWER,
      at: "2026-10-01T00:00:00.000Z",
      source: "interview",
      ...extra,
    });

    it("keys an answer through its brief even after the Fact's id changed", () => {
      writeScan(paths);
      const { sha } = writeKbBrief(paths);
      // A later scan gives the flow a new id; the old answer still cites the old one.
      writeScan(paths, (facts) => {
        facts.dataFlows = facts.dataFlows.map((f) => (f.id === "flow_mail" ? { ...f, id: "flow_mail_2" } : f));
      });
      appendAnswers(paths, [old("ans_a", "flow_mail", { briefSha: sha })]);

      const result = migrateAnswerFingerprints(paths);
      expect(result).toMatchObject({ migrated: 1, outcomes: { ans_a: "brief" }, unresolved: [], withoutFingerprint: [] });
      const [answer] = readAnswers(paths).answers;
      expect(answer).toMatchObject({ identityKey: KEYS.flow_mail, fingerprintSource: "migrated" });
      expect(answer!.fingerprint?.key).toBe(KEYS.flow_mail);
    });

    it("falls back to the current scan, keys system answers, and is idempotent", () => {
      writeScan(paths);
      appendAnswers(paths, [
        old("ans_b", "cmp_user", { property: "actor_kind", value: "persona" }),
        old("ans_c", "dp:a0/system", { property: "in_scope", value: "The web app" }),
        old("ans_d", "cmp_gone"),
      ]);
      const first = migrateAnswerFingerprints(paths);
      expect(first.outcomes).toEqual({ ans_b: "scan", ans_c: "system", ans_d: "unresolved" });
      expect(first.unresolved).toEqual(["ans_d"]);
      const again = migrateAnswerFingerprints(paths);
      expect(again).toMatchObject({ migrated: 0, alreadyKeyed: 2, unresolved: ["ans_d"] });
    });

    it("maps the root Application named after the folder to the project-name token (DATAP-858)", () => {
      const rootKey = `app:<unsectioned>|asset|application|package.json|${PROJECT_NAME_KEY_TOKEN}`;
      const folderKey = "app:<unsectioned>|asset|application|package.json|my-checkout";
      const root = { id: "cmp_root", name: "my-checkout", type: "asset", subType: "application", confidence: 1, sourceLocations: [], codeRefs: [] };
      // The brief was written before DATAP-858: the root's key and id came from the folder name.
      writeScan(paths, (facts) => {
        facts.components.push({ ...root, identity: { kind: "component", key: folderKey, parts: {} } });
        facts.dataFlows.push({ id: "flow_root", sourceComponentId: "cmp_root", targetComponentId: "cmp_mail", type: "api_call", confidence: 0.9, sourceLocations: [], codeRefs: [], identity: { kind: "dataFlow", key: "flow-root", parts: {} } });
      });
      const { sha } = writeKbBrief(paths);
      writeScan(paths, (facts) => {
        facts.components.push({ ...root, id: "cmp_root_new", identity: { kind: "component", key: rootKey, parts: {} } });
      });
      appendAnswers(paths, [old("ans_root", "cmp_root", { briefSha: sha, property: "actor_kind" })]);

      const result = migrateAnswerFingerprints(paths, { dryRun: true });
      expect(result.outcomes).toEqual({ ans_root: "root" });
      // A dry run writes nothing.
      expect(readAnswers(paths).answers[0]!.identityKey).toBeUndefined();
      migrateAnswerFingerprints(paths);
      expect(readAnswers(paths).answers[0]).toMatchObject({ identityKey: rootKey, fingerprintSource: "migrated" });
    });
  });
});
