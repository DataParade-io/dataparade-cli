import fs from "fs";
import os from "os";
import path from "path";

import type { DataParadeGraph } from "@dataparade/scanner";

import type { OrchestratorScanResult } from "../../../src/core/pipeline/orchestrator-result";
import { buildFacts } from "../../../src/facts/build-facts";
import { readAnswers, readDataItemFiles, readFacts, writeFactsOutput, appendAnswers } from "../../../src/facts/io";
import { layoutForDir } from "../../../src/facts/layout";
import { dataFlowFactSchema, dataItemFileSchema, factsFileSchema } from "../../../src/facts/schema";

const ROOT = "/Users/dev/projects/shop";

function scanResult(): OrchestratorScanResult {
  return {
    scanResult: {
      components: [
        { id: "cmp_api", name: "api", type: "asset", subType: "service", confidence: 0.9, detectedFrom: [], sourceLocations: [{ filePath: `${ROOT}/src/api.ts`, startLine: 1, endLine: 2 }], properties: {} },
        { id: "cmp_mail", name: "Sendgrid", type: "third_party", confidence: 0.8, detectedFrom: [], sourceLocations: [], properties: {} },
      ],
      dataFlows: [
        { id: "flow_mail", sourceComponentId: "cmp_api", targetComponentId: "cmp_mail", type: "api_call", confidence: 0.9, sourceLocations: [{ filePath: "src/api.ts", startLine: 5, endLine: 5 }] },
      ],
    },
    files: [],
    findings: [],
    occurrences: [
      { id: "occurrence:email:src/api.ts:4", filePath: "src/api.ts", startLine: 4, endLine: 4, code: "const email", labels: ["contact"], group: "email:customer", groupBasis: "column", declaration: { line: 3, kind: "const" } },
      { id: "occurrence:email:src/api.ts:3", filePath: "src/api.ts", startLine: 3, endLine: 3, labels: [], group: "email:customer", groupBasis: "column" },
      { id: `occurrence:email:${ROOT}/src/abs.ts:9`, filePath: `${ROOT}/src/abs.ts`, startLine: 9, endLine: 9, labels: [] },
      { id: "occurrence:Credit Card:src/pay.ts:2", filePath: "src/pay.ts", startLine: 2, endLine: 2, labels: [], location: "comment" },
    ],
    dataItems: [
      { id: "data_item:email", labels: ["contact"], occurrenceIds: ["occurrence:email:src/api.ts:4", "occurrence:email:src/api.ts:3", `occurrence:email:${ROOT}/src/abs.ts:9`], groups: [{ id: "email:customer", occurrenceIds: ["occurrence:email:src/api.ts:4", "occurrence:email:src/api.ts:3"] }] },
      { id: "data_item:Credit Card", labels: [], occurrenceIds: ["occurrence:Credit Card:src/pay.ts:2"] },
    ],
  } as unknown as OrchestratorScanResult;
}

function graph(): DataParadeGraph {
  const base = { confidence: "EXTRACTED", confidence_score: 1, source_file: null, source_location: null } as const;
  return {
    directed: true,
    multigraph: false,
    graph: { schema: "dataparade-graph/1" },
    nodes: [],
    links: [
      { ...base, source: "dp::occurrence:email:src/api.ts:4", target: "src_api_ts_handler", relation: "occurs_in", target_kind: "function", target_file: "src/api.ts", target_line: 3 },
      { ...base, source: "dp::cmp_api", target: `${ROOT}/src/api.ts`, relation: "defined_in", target_kind: "file", target_file: `${ROOT}/src/api.ts`, target_line: 1 },
      { ...base, source: "dp::flow_mail", target: "src_api_ts_send", relation: "observed_in", target_kind: "function", target_file: "src/api.ts", target_line: 5 },
      { ...base, source: "dp::occurrence:email:src/api.ts:4", target: "dp::occurrence:email:src/api.ts:3", relation: "declared_by", declaration_kind: "const" },
      { ...base, source: "dp::occurrence:email:src/api.ts:4", target: "dp::group:email:customer", relation: "occurrence_of" },
      { ...base, source: "dp::group:email:customer", target: "dp::data_item:email", relation: "part_of" },
      { ...base, source: "dp::group:email:customer", target: "dp::cmp_api", relation: "handled_by", confidence: "INFERRED", confidence_score: 0.65, basis: "same_file" },
      { ...base, source: "dp::group:email:customer", target: "dp::cmp_api", relation: "handled_by", confidence: "INFERRED", confidence_score: 0.65, basis: "same_file" },
      { ...base, source: "dp::cmp_api", target: "dp::flow_mail", relation: "sends" },
      { ...base, source: "dp::flow_mail", target: "dp::cmp_mail", relation: "delivers_to" },
    ],
  } as unknown as DataParadeGraph;
}

const meta = { scanRoot: ROOT, projectName: "shop", cliVersion: "0.0.27", scannerVersion: "abc", scannedAt: "2026-10-09T00:00:00.000Z" };

describe("buildFacts", () => {
  const { facts, dataItemFiles } = buildFacts({ result: scanResult(), graph: graph(), ...meta });

  it("matches the schemas", () => {
    expect(() => factsFileSchema.parse(facts)).not.toThrow();
    for (const file of dataItemFiles.values()) expect(() => dataItemFileSchema.parse(file)).not.toThrow();
  });

  it("writes components and flows with code refs, relative to the scan root", () => {
    expect(facts.scan).toEqual({ projectName: "shop", scannedAt: "2026-10-09T00:00:00.000Z", cliVersion: "0.0.27", scannerVersion: "abc" });
    const api = facts.components.find((c) => c.id === "cmp_api");
    expect(api?.sourceLocations).toEqual([{ filePath: "src/api.ts", startLine: 1, endLine: 2 }]);
    expect(api?.codeRefs).toEqual([{ nodeId: "src/api.ts", kind: "file", filePath: "src/api.ts", line: 1 }]);
    expect(facts.components.find((c) => c.id === "cmp_mail")).toMatchObject({ subType: "", codeRefs: [] });
    const flow = facts.dataFlows[0];
    expect(dataFlowFactSchema.parse(flow).codeRefs).toEqual([{ nodeId: "src_api_ts_send", kind: "function", filePath: "src/api.ts", line: 5 }]);
  });

  it("never contains the scan root, in any id or path", () => {
    const everything = JSON.stringify([facts, [...dataItemFiles.values()]]);
    expect(everything).not.toContain(ROOT);
    expect(everything).not.toContain("/Users/");
  });

  it("summarises data items with groups, and points to one file per item", () => {
    expect(facts.dataItems.map((i) => [i.id, i.file, i.occurrenceCount])).toEqual([
      ["data_item:Credit Card", "data-items/credit-card.json", 1],
      ["data_item:email", "data-items/email.json", 3],
    ]);
    const email = facts.dataItems.find((i) => i.name === "email");
    expect(email?.groups).toEqual([
      {
        id: "group:email:customer",
        identity: { kind: "group", key: "email:customer", parts: { dataItem: "email", qualifier: "customer" } },
        label: "customer",
        basis: "column",
        occurrenceCount: 2,
        handledBy: ["cmp_api"],
      },
    ]);
    expect([...dataItemFiles.keys()].sort()).toEqual(["data-items/credit-card.json", "data-items/email.json"]);
  });

  it("puts every occurrence once, in its data item file, with group, code refs and declaration", () => {
    const email = dataItemFiles.get("data-items/email.json");
    expect(email?.groups).toEqual(facts.dataItems.find((i) => i.name === "email")?.groups);
    expect(email?.occurrences.map((o) => o.id)).toEqual([
      "occurrence:email:src/abs.ts:9",
      "occurrence:email:src/api.ts:3",
      "occurrence:email:src/api.ts:4",
    ]);
    const first = email?.occurrences.find((o) => o.id === "occurrence:email:src/api.ts:4");
    expect(first).toMatchObject({
      groupId: "group:email:customer",
      filePath: "src/api.ts",
      code: "const email",
      codeRefs: [{ nodeId: "src_api_ts_handler", kind: "function", filePath: "src/api.ts", line: 3 }],
      declaredBy: { id: "occurrence:email:src/api.ts:3", kind: "const" },
    });
    expect(email?.occurrences.find((o) => o.id.endsWith("abs.ts:9"))?.groupId).toBeNull();
    expect(dataItemFiles.get("data-items/credit-card.json")?.occurrences[0].location).toBe("comment");
    expect(JSON.stringify(facts)).not.toContain("occurrence:email:src/api.ts:4");
  });

  it("keeps the non-occurrence links as relations, once, without code or structure links", () => {
    expect(facts.relations.map((r) => `${r.type} ${r.source} ${r.target}`)).toEqual([
      "delivers_to flow_mail cmp_mail",
      "handled_by group:email:customer cmp_api",
      "sends cmp_api flow_mail",
    ]);
  });

  it("gives every component, flow, data item and group an identity", () => {
    expect(facts.components.find((c) => c.id === "cmp_api")?.identity).toEqual({
      kind: "component",
      key: "app:<unsectioned>|asset|service|src/api.ts|api",
      parts: { scheme: "app", section: "<unsectioned>", type: "asset", subType: "service", file: "src/api.ts", name: "api" },
    });
    expect(facts.dataFlows[0].identity).toMatchObject({ kind: "dataFlow", parts: { source: "app:<unsectioned>|asset|service|src/api.ts|api", file: "src/api.ts" } });
    const email = facts.dataItems.find((d) => d.name === "email");
    expect(email?.identity).toEqual({ kind: "dataItem", key: "email", parts: { name: "email" } });
    expect(email?.groups[0].identity).toEqual({ kind: "group", key: "email:customer", parts: { dataItem: "email", qualifier: "customer" } });
    expect(dataItemFiles.get(email!.file)?.identity).toEqual(email?.identity);
  });

  it("drops the line from a declaration-named group's key, and numbers groups that share a key", () => {
    const result = scanResult();
    const occurrences = [
      { id: "occurrence:phone:src/a.ts:12", filePath: `${ROOT}/src/a.ts`, startLine: 12, endLine: 12, labels: [] },
      { id: "occurrence:phone:src/a.ts:30", filePath: "src/a.ts", startLine: 30, endLine: 30, labels: [] },
      { id: "occurrence:phone:src/a.ts:7", filePath: "src/a.ts", startLine: 7, endLine: 7, labels: [] },
    ];
    result.occurrences.push(...(occurrences as typeof result.occurrences));
    result.dataItems.push({
      id: "data_item:phone",
      labels: [],
      occurrenceIds: occurrences.map((o) => o.id),
      groups: [
        { id: `phone@${ROOT}/src/a.ts:12#phone`, occurrenceIds: [occurrences[0].id] },
        { id: "phone@src/a.ts:30", occurrenceIds: [occurrences[1].id] },
        { id: "phone@src/a.ts:7", occurrenceIds: [occurrences[2].id] },
      ],
    } as (typeof result.dataItems)[number]);
    const groups = buildFacts({ result, graph: graph(), ...meta }).facts.dataItems.find((i) => i.name === "phone")!.groups;
    const byId = new Map(groups.map((g) => [g.id, g.identity]));
    expect(byId.get("group:phone@src/a.ts:12#phone")).toEqual({
      kind: "group",
      key: "phone@src/a.ts#phone",
      parts: { dataItem: "phone", declarationFile: "src/a.ts", declarationName: "phone" },
    });
    // Two unnamed declarations in one file share a key; the earlier line keeps it.
    expect(byId.get("group:phone@src/a.ts:7")).toEqual({ kind: "group", key: "phone@src/a.ts", parts: { dataItem: "phone", declarationFile: "src/a.ts" } });
    expect(byId.get("group:phone@src/a.ts:30")).toMatchObject({ key: "phone@src/a.ts#2", duplicateIndex: 2 });
  });

  it("writes scan stamps when given, and leaves them out otherwise (DATAP-876)", () => {
    expect(facts.scan).not.toHaveProperty("stamps");
    const stamps = {
      scannerCommit: "f".repeat(40),
      cliVersion: "0.0.32",
      catalogHash: "sha256:0123456789abcdef",
      configHash: "sha256:fedcba9876543210",
      aiInference: false,
      structureGraph: true,
      commitSha: "a".repeat(40),
      dirty: false,
      rootCommitSha: "b".repeat(40),
      scanRoot: "",
    };
    const stamped = buildFacts({ result: scanResult(), graph: graph(), ...meta, stamps }).facts;
    expect(stamped.scan.stamps).toEqual(stamps);
    expect(() => factsFileSchema.parse(stamped)).not.toThrow();
  });

  it("works without a knowledge graph", () => {
    const bare = buildFacts({ result: scanResult(), ...meta });
    expect(bare.facts.relations).toEqual([]);
    expect(bare.facts.components[0].codeRefs).toEqual([]);
    expect(bare.facts.dataItems.find((i) => i.name === "email")?.groups[0].handledBy).toEqual([]);
  });
});

describe("writing and reading Facts", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-facts-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("writes facts.json and one file per data item, and reads them back", () => {
    const layout = layoutForDir(dir);
    const built = buildFacts({ result: scanResult(), graph: graph(), ...meta });
    writeFactsOutput(layout, built.facts, built.dataItemFiles);
    expect(fs.readdirSync(dir).sort()).toEqual(["data-items", "facts.json"]);
    expect(fs.readdirSync(layout.dataItemsDir).sort()).toEqual(["credit-card.json", "email.json"]);
    const facts = readFacts(layout);
    expect(facts).toEqual(built.facts);
    expect(readDataItemFiles(layout, facts).map((f) => f.name)).toEqual(["Credit Card", "email"]);
  });

  it("replaces facts.json and removes stale data item files on a rescan, but keeps answers.json", () => {
    const layout = layoutForDir(dir);
    const first = buildFacts({ result: scanResult(), ...meta });
    writeFactsOutput(layout, first.facts, first.dataItemFiles);
    appendAnswers(layout, [{ id: "ans_1", factId: "cmp_api", action: "set", property: "name", value: "API", by: "dev@example.com", at: "2026-10-10T00:00:00.000Z", source: "review" }]);
    const answersBefore = fs.readFileSync(layout.answersPath, "utf8");

    const next = scanResult();
    next.dataItems = next.dataItems.slice(0, 1);
    const second = buildFacts({ result: next, ...meta, scannedAt: "2026-10-11T00:00:00.000Z" });
    writeFactsOutput(layout, second.facts, second.dataItemFiles);

    expect(fs.readdirSync(layout.dataItemsDir)).toEqual(["email.json"]);
    expect(readFacts(layout).scan.scannedAt).toBe("2026-10-11T00:00:00.000Z");
    expect(fs.readFileSync(layout.answersPath, "utf8")).toBe(answersBefore);
    expect(readAnswers(layout).answers).toHaveLength(1);
  });

  it("reads an empty answers list when answers.json does not exist", () => {
    expect(readAnswers(layoutForDir(dir))).toEqual({ schemaVersion: 1, answers: [] });
  });
});
