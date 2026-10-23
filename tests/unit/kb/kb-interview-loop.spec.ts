import fs from "fs";
import path from "path";

import { readAnswers, writeFactsOutput } from "../../../src/facts/io";
import { readKbBrief, writeKbBrief } from "../../../src/kb/brief";
import { loadKbState, type KbPaths } from "../../../src/kb/kb-store";
import { landInterviewAnswer, landReviewAnswer } from "../../../src/kb/land";
import { writeKbDiagram } from "../../../src/kb/project-diagram";
import { makeKbDir, sampleFacts } from "../../helpers/facts-fixture";

const SKILL_SHA = "f".repeat(40);
const REVIEWER = "dev@example.com";

/** A rescan: Facts are replaced, answers.json is not touched. */
function rescan(paths: KbPaths, keepFlows = ["flow_mail", "flow_login"]) {
  const { facts, files } = sampleFacts();
  facts.dataFlows = facts.dataFlows.filter((f) => keepFlows.includes(f.id));
  writeFactsOutput(paths, facts, new Map(files.map((file) => [`data-items/${file.name}.json`, file])));
}

describe("live interview loop: brief → land → project", () => {
  let paths: KbPaths;
  let evidence: string;
  beforeEach(() => {
    paths = makeKbDir();
    fs.mkdirSync(paths.evidenceDir, { recursive: true });
    evidence = "evidence/2026-10-09-session.md";
    fs.writeFileSync(path.join(paths.dir, evidence), "Q: What goes to Sendgrid?\nA: Customer email addresses, to send receipts.\n");
  });
  afterEach(() => fs.rmSync(paths.dir, { recursive: true, force: true }));

  const land = (brief: string, target: string, slot: string, value: string, extra: Record<string, unknown> = {}) =>
    landInterviewAnswer(paths, { briefSha: brief, target, slot, value, reviewer: REVIEWER, evidence, skillSha: SKILL_SHA, ...extra });

  it("orders questions: scope, outbound third-party flows, then people only", () => {
    const { brief, sha } = writeKbBrief(paths);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(brief.questions.map((q) => `${q.slot}:${q.asserts.split("/").pop()}`)).toEqual([
      "in_scope:system",
      "data_categories:flow_mail",
      "purpose:flow_mail",
      "actor_kind:cmp_user",
    ]);
    expect(brief.flows.map((f) => f.crossing).sort()).toEqual(["from_actor", "outbound_third_party"]);
    expect(brief.questions.every((q) => q.status === "unknown")).toBe(true);
    // Same KB state, same snapshot.
    expect(writeKbBrief(paths).sha).toBe(sha);
  });

  it("lands confirmed answers and projects them onto the diagram", () => {
    const { sha } = writeKbBrief(paths);
    land(sha, "flow_mail", "data_categories", "contact, identifiers");
    land(sha, "flow_mail", "purpose", "service_provision");
    land(sha, "cmp_user", "actor_kind", "persona");
    land(sha, "dp:a0/system", "in_scope", "The DataParade web app and its backend");

    const next = writeKbBrief(paths);
    expect(next.sha).not.toBe(sha);
    expect(next.brief.questions.filter((q) => q.status === "unknown")).toEqual([]);

    const { wrapper } = writeKbDiagram(paths, { projectName: "DataParade" });
    const mail = wrapper.graph.edges.find((e) => e.id === "flow_mail") as { data: { privacy: Record<string, unknown> } };
    expect(mail.data.privacy).toMatchObject({
      dataCategories: ["contact", "identifiers"],
      purpose: "service_provision",
      slotStatus: "known",
      openSlots: [],
    });
    const login = wrapper.graph.edges.find((e) => e.id === "flow_login") as { data: { privacy: Record<string, unknown> } };
    expect(login.data.privacy).toMatchObject({ slotStatus: "unknown", openSlots: ["data_categories", "purpose"] });
    const user = wrapper.graph.nodes.find((n) => n.id === "cmp_user") as { data: Record<string, unknown> };
    expect(user.data.label).toBe("Customer");
    const system = wrapper.graph.nodes.find((n) => n.id === "system") as { data: Record<string, unknown> };
    expect(system.data).toMatchObject({ label: "DataParade", description: "The DataParade web app and its backend" });
  });

  it("records a correction that supersedes the earlier answer", () => {
    const { sha } = writeKbBrief(paths);
    const first = land(sha, "flow_mail", "purpose", "marketing", { now: new Date(Date.now() - 1000) });
    const second = land(sha, "flow_mail", "purpose", "service_provision", { now: new Date(Date.now() + 1000) });
    expect(second.supersedes).toBe(first.id);
    expect(second.id).not.toBe(first.id);
    expect(readAnswers(paths).answers).toHaveLength(2);
    const flow = loadKbState(paths).document.dataFlows.find((f) => f.id === "flow_mail");
    expect(flow?.purpose).toBe("service_provision");
  });

  it.each([
    ["an invented category", "flow_mail", "data_categories", "emails", {}, /unknown data category/],
    ["unspecified as a category", "flow_mail", "data_categories", "unspecified", {}, /no 'unspecified'/],
    ["a purpose outside the enum", "flow_mail", "purpose", "billing", {}, /purpose must be one of/],
    ["two actor kinds", "cmp_user", "actor_kind", "Customer (persona)", {}, /exactly one of/],
    ["a scan-owned slot", "cmp_mail", "name", "SendGrid Inc", {}, /can't land from an interview/],
    ["a target the brief doesn't ask about", "cmp_mail", "actor_kind", "person", {}, /no 'actor_kind' question/],
    ["a from-actor flow slot", "flow_login", "purpose", "security", {}, /no 'purpose' question/],
    ["an agent as reviewer", "flow_mail", "purpose", "service_provision", { reviewer: "claude-code" }, /reviewer must be the developer/],
    ["missing evidence", "flow_mail", "purpose", "service_provision", { evidence: "evidence/nope.md" }, /Evidence transcript not found/],
    ["a short skill sha", "flow_mail", "purpose", "service_provision", { skillSha: "abc123" }, /skill SHA/],
  ])("refuses %s", (_label, target, slot, value, extra, message) => {
    const { sha } = writeKbBrief(paths);
    expect(() => land(sha, target, slot, value, extra)).toThrow(message);
  });

  it("refuses an unknown or edited brief", () => {
    expect(() => land("0".repeat(40), "flow_mail", "purpose", "security")).toThrow(/No brief/);
    const { sha, path: briefPath } = writeKbBrief(paths);
    const edited = JSON.parse(fs.readFileSync(briefPath, "utf8"));
    edited.questions.push({ asserts: "cmp_mail", slot: "actor_kind", shape: "D4", status: "unknown", about: "" });
    fs.writeFileSync(briefPath, JSON.stringify(edited));
    expect(() => readKbBrief(paths, sha)).toThrow(/edited after it was written/);
  });

  it("keeps an answer about a flow the next scan no longer has, without breaking projection", () => {
    const { sha } = writeKbBrief(paths);
    land(sha, "flow_mail", "purpose", "security");
    rescan(paths, ["flow_login"]); // re-scan: flow_mail is gone
    const state = loadKbState(paths);
    expect(state.orphans).toHaveLength(1);
    expect(state.answers.filter((a) => a.source === "interview")).toHaveLength(1);
    expect(() => writeKbDiagram(paths)).not.toThrow();
    expect(writeKbBrief(paths).orphanCount).toBe(1);
  });

  it("does not land on --dry-run", () => {
    const { sha } = writeKbBrief(paths);
    const result = land(sha, "flow_mail", "purpose", "security", { dryRun: true });
    expect(result.path).toBeNull();
    expect(fs.existsSync(paths.answersPath)).toBe(false);
  });

  it("stores the who, when and evidence of an interview answer, with a category list as a list", () => {
    const { sha } = writeKbBrief(paths);
    const landed = land(sha, "flow_mail", "data_categories", "identifiers, contact", { now: new Date("2026-10-10T12:00:00.000Z") });
    expect(landed.path).toBe(paths.answersPath);
    expect(readAnswers(paths).answers).toEqual([
      {
        id: landed.id,
        factId: "flow_mail",
        action: "set",
        property: "data_categories",
        value: ["contact", "identifiers"],
        by: REVIEWER,
        at: "2026-10-10T12:00:00.000Z",
        source: "interview",
        evidence,
        briefSha: sha,
        skillSha: SKILL_SHA,
      },
    ]);
  });

  it("does not change facts.json when answers land, and a rescan keeps answers.json", () => {
    const { sha } = writeKbBrief(paths);
    land(sha, "flow_mail", "purpose", "security");
    const factsBefore = fs.readFileSync(paths.factsPath, "utf8");
    expect(factsBefore).not.toContain("security");
    const answersBefore = fs.readFileSync(paths.answersPath, "utf8");
    rescan(paths);
    expect(fs.readFileSync(paths.answersPath, "utf8")).toBe(answersBefore);
    expect(loadKbState(paths).document.dataFlows.find((f) => f.id === "flow_mail")?.purpose).toBe("security");
  });

  describe("review answers", () => {
    const review = (input: Partial<Parameters<typeof landReviewAnswer>[1]> & { target: string }) =>
      landReviewAnswer(paths, { action: "set", reviewer: REVIEWER, ...input });

    it("removes a Fact and sets a property, and the applied state shows both", () => {
      review({ target: "flow_login", action: "remove", evidence: "not a real flow" });
      review({ target: "cmp_mail", property: "name", value: "SendGrid Inc" });
      const state = loadKbState(paths);
      expect(state.applied.facts.dataFlows.map((f) => f.id)).toEqual(["flow_mail"]);
      expect(state.document.components.find((c) => c.id === "cmp_mail")?.name).toBe("SendGrid Inc");
      const [removed, set] = readAnswers(paths).answers;
      expect(removed).toMatchObject({ factId: "flow_login", action: "remove", source: "review", by: REVIEWER, evidence: "not a real flow" });
      expect(set).toMatchObject({ factId: "cmp_mail", action: "set", property: "name", value: "SendGrid Inc" });
      // The removed flow is no longer asked about.
      expect(writeKbBrief(paths).brief.flows.map((f) => f.id)).toEqual(["flow_mail"]);
    });

    it("reads a JSON value for lists", () => {
      review({ target: "data_item:email", property: "labels", value: '["contact","pii"]' });
      expect(loadKbState(paths).applied.facts.dataItems[0].labels).toEqual(["contact", "pii"]);
    });

    it.each([
      ["an unknown Fact", { target: "flow_nope", action: "remove" as const }, /not a Fact in this scan/],
      ["a protected property", { target: "cmp_api", property: "id", value: "x" }, /can't be changed/],
      ["a set without a value", { target: "cmp_api", property: "name" }, /needs both a property and a value/],
      ["a remove with a value", { target: "cmp_api", action: "remove" as const, value: "x" }, /takes no property or value/],
      ["a model as reviewer", { target: "cmp_api", property: "name", value: "x", reviewer: "claude-code" }, /reviewer must be the developer/],
    ])("refuses %s", (_label, input, message) => {
      expect(() => review(input)).toThrow(message);
      expect(fs.existsSync(paths.answersPath)).toBe(false);
    });
  });

  it("needs a scan first", () => {
    fs.rmSync(paths.factsPath);
    expect(() => writeKbBrief(paths)).toThrow(/No facts\.json/);
  });
});
