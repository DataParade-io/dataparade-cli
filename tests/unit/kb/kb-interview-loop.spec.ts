import fs from "fs";
import os from "os";
import path from "path";

import { landScanDiscoveryToOcsfRecords } from "../../../src/discoveries/scan-discovery-to-ocsf";
import { scanEntityAsserts } from "../../../src/discoveries/scan-entity-uri";
import {
  removeScanRecordsForScanPath,
  writeOcsfDiscoveryRecordsToDir,
} from "../../../src/discoveries/write-ocsf-discoveries";
import { readKbBrief, writeKbBrief } from "../../../src/kb/brief";
import { loadKbState, resolveKbPaths, type KbPaths } from "../../../src/kb/kb-store";
import { landInterviewAnswer } from "../../../src/kb/land";
import { writeKbDiagram } from "../../../src/kb/project-diagram";

const SCAN_PATH = "/repo";
const SKILL_SHA = "f".repeat(40);
const REVIEWER = "dev@example.com";

function writeScan(paths: KbPaths, flows = ["flow_mail", "flow_login"]) {
  const records = landScanDiscoveryToOcsfRecords(
    {
      scanPath: SCAN_PATH,
      components: [
        { id: "cmp_api", name: "backend", type: "asset", subType: "service", confidence: 0.9, sourceLocations: [{ filePath: "backend/src/main.ts", startLine: 1, endLine: 1 }] },
        { id: "cmp_mail", name: "Sendgrid", type: "third_party", subType: "email", confidence: 0.9, sourceLocations: [] },
        { id: "cmp_user", name: "Customer", type: "actor", subType: "", confidence: 0.8, sourceLocations: [] },
      ],
      dataFlows: [
        { id: "flow_mail", sourceComponentId: "cmp_api", targetComponentId: "cmp_mail", type: "api_call", confidence: 0.9 },
        { id: "flow_login", sourceComponentId: "cmp_user", targetComponentId: "cmp_api", type: "api_call", confidence: 0.9 },
      ].filter((f) => flows.includes(f.id)),
      occurrences: [],
      dataItems: [],
    },
    { assertedAt: "2026-10-09T00:00:00.000Z" },
  );
  removeScanRecordsForScanPath(paths.discoveriesDir, SCAN_PATH);
  writeOcsfDiscoveryRecordsToDir(records, paths.discoveriesDir);
}

describe("live interview loop: brief → land → project", () => {
  let paths: KbPaths;
  let evidence: string;
  beforeEach(() => {
    paths = resolveKbPaths(fs.mkdtempSync(path.join(os.tmpdir(), "dp-kb-")));
    writeScan(paths);
    fs.mkdirSync(paths.evidenceDir, { recursive: true });
    evidence = "evidence/2026-10-09-session.md";
    fs.writeFileSync(path.join(paths.root, evidence), "Q: What goes to Sendgrid?\nA: Customer email addresses, to send receipts.\n");
  });
  afterEach(() => fs.rmSync(paths.root, { recursive: true, force: true }));

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
    const first = land(sha, "flow_mail", "purpose", "marketing");
    const second = land(sha, "flow_mail", "purpose", "service_provision");
    expect(second.supersedes).toBe(first.uid);
    expect(second.uid).not.toBe(first.uid);
    const flow = loadKbState(paths).document.dataFlows.find((f) => f.id.endsWith("flow_mail"));
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
    edited.questions.push({ asserts: scanEntityAsserts(SCAN_PATH, "cmp_mail"), slot: "actor_kind", shape: "D4", status: "unknown", about: "" });
    fs.writeFileSync(briefPath, JSON.stringify(edited));
    expect(() => readKbBrief(paths, sha)).toThrow(/edited after it was written/);
  });

  it("keeps an answer about a flow the next scan no longer has, without breaking projection", () => {
    const { sha } = writeKbBrief(paths);
    land(sha, "flow_mail", "purpose", "security");
    writeScan(paths, ["flow_login"]); // re-scan: flow_mail is gone
    const state = loadKbState(paths);
    expect(state.orphans).toHaveLength(1);
    expect(state.records.filter((r) => r.dataparade.source === "interview")).toHaveLength(1);
    expect(() => writeKbDiagram(paths)).not.toThrow();
    expect(writeKbBrief(paths).orphanCount).toBe(1);
  });

  it("does not land on --dry-run", () => {
    const { sha } = writeKbBrief(paths);
    const result = land(sha, "flow_mail", "purpose", "security", { dryRun: true });
    expect(result.path).toBeNull();
    expect(loadKbState(paths).records.some((r) => r.dataparade.source === "interview")).toBe(false);
  });
});
