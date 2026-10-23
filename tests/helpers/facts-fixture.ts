import fs from "fs";
import os from "os";
import path from "path";

import { writeFactsOutput } from "../../src/facts/io";
import { layoutForDir, type OutputLayout } from "../../src/facts/layout";
import type { DataItemFile, FactsFile } from "../../src/facts/schema";

/** A small scan: an API, Sendgrid, a customer, two flows, and an email data item with two groups. */
export function sampleFacts(): { facts: FactsFile; files: DataItemFile[] } {
  const groups = [
    { id: "group:email:customer", label: "customer", basis: "column", occurrenceCount: 2, handledBy: ["cmp_api"] },
    { id: "group:email:staff", label: "staff", basis: "name", occurrenceCount: 1, handledBy: ["cmp_api", "cmp_mail"] },
  ];
  const emailFile: DataItemFile = {
    schemaVersion: 1,
    id: "data_item:email",
    name: "email",
    labels: ["contact"],
    groups,
    occurrences: [
      { id: "occurrence:email:src/a.ts:3", groupId: "group:email:customer", filePath: "src/a.ts", startLine: 3, endLine: 3, code: "email", labels: ["contact"], codeRefs: [] },
      { id: "occurrence:email:src/b.ts:9", groupId: "group:email:customer", filePath: "src/b.ts", startLine: 9, endLine: 9, labels: ["contact"], codeRefs: [] },
      { id: "occurrence:email:src/c.ts:1", groupId: "group:email:staff", filePath: "src/c.ts", startLine: 1, endLine: 1, labels: [], codeRefs: [] },
    ],
  };
  const phoneFile: DataItemFile = {
    schemaVersion: 1,
    id: "data_item:phone",
    name: "phone",
    labels: [],
    groups: [{ id: "group:phone:customer", label: "customer", occurrenceCount: 1, handledBy: ["cmp_api"] }],
    occurrences: [
      { id: "occurrence:phone:src/a.ts:7", groupId: "group:phone:customer", filePath: "src/a.ts", startLine: 7, endLine: 7, labels: [], codeRefs: [] },
    ],
  };
  const facts: FactsFile = {
    schemaVersion: 1,
    scan: { projectName: "demo", scannedAt: "2026-10-09T00:00:00.000Z", cliVersion: "0.0.27", scannerVersion: "abc123" },
    components: [
      { id: "cmp_api", name: "backend", type: "asset", subType: "service", confidence: 0.9, sourceLocations: [{ filePath: "backend/src/main.ts", startLine: 1, endLine: 1 }], codeRefs: [] },
      { id: "cmp_mail", name: "Sendgrid", type: "third_party", subType: "email", confidence: 0.9, sourceLocations: [], codeRefs: [] },
      { id: "cmp_user", name: "Customer", type: "actor", subType: "", confidence: 0.8, sourceLocations: [], codeRefs: [] },
    ],
    dataFlows: [
      { id: "flow_mail", sourceComponentId: "cmp_api", targetComponentId: "cmp_mail", type: "api_call", confidence: 0.9, sourceLocations: [], codeRefs: [] },
      { id: "flow_login", sourceComponentId: "cmp_user", targetComponentId: "cmp_api", type: "api_call", confidence: 0.9, sourceLocations: [], codeRefs: [] },
    ],
    dataItems: [
      { id: "data_item:email", name: "email", labels: ["contact"], occurrenceCount: 3, file: "data-items/email.json", groups },
      { id: "data_item:phone", name: "phone", labels: [], occurrenceCount: 1, file: "data-items/phone.json", groups: phoneFile.groups },
    ],
    relations: [
      { type: "sends", source: "cmp_api", target: "flow_mail", confidence: "EXTRACTED", basis: null },
      { type: "delivers_to", source: "flow_mail", target: "cmp_mail", confidence: "EXTRACTED", basis: null },
      { type: "handled_by", source: "group:email:staff", target: "cmp_mail", confidence: "INFERRED", basis: "same_file" },
    ],
  };
  return { facts, files: [emailFile, phoneFile] };
}

/** A knowledge base folder holding sampleFacts(). */
export function makeKbDir(): OutputLayout {
  const layout = layoutForDir(fs.mkdtempSync(path.join(os.tmpdir(), "dp-kb-")));
  const { facts, files } = sampleFacts();
  writeFactsOutput(layout, facts, new Map(files.map((file) => [`data-items/${file.name}.json`, file])));
  fs.writeFileSync(layout.dataflowPath, JSON.stringify({ schemaVersion: "1.0", graph: { nodes: [], edges: [] }, metadata: { projectName: "demo" } }));
  return layout;
}
