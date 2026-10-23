import fs from "fs";
import os from "os";
import path from "path";

import { loadOcsfDiscoveriesFromDir } from "../../../src/discoveries/load-ocsf-discoveries";
import { exportOcsf } from "../../../src/export/export-ocsf";
import { writeKbBrief } from "../../../src/kb/brief";
import { landInterviewAnswer, landReviewAnswer } from "../../../src/kb/land";
import { makeKbDir } from "../../helpers/facts-fixture";

describe("export ocsf", () => {
  let paths: ReturnType<typeof makeKbDir>;
  let out: string;
  beforeEach(() => {
    paths = makeKbDir();
    out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dp-export-")), "ocsf");
  });
  afterEach(() => {
    fs.rmSync(paths.dir, { recursive: true, force: true });
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  });

  const slot = (records: ReturnType<typeof loadOcsfDiscoveriesFromDir>["records"], name: string) =>
    records.filter((r) => r.dataparade.asserted_slot === name).map((r) => r.dataparade.asserted_value);

  it("writes valid OCSF records for the Facts, with no absolute paths", () => {
    const result = exportOcsf(paths, out);
    expect(result.interviewRecords).toBe(0);
    expect(result.records).toBe(result.scanRecords);
    const { records } = loadOcsfDiscoveriesFromDir(out);
    expect(records).toHaveLength(result.records);
    expect(slot(records, "name").sort()).toEqual(["Customer", "Sendgrid", "backend"]);
    expect(records.some((r) => r.dataparade.asserts === "dp:scan/entity/occurrence:email:src/a.ts:3")).toBe(true);
    expect(records.some((r) => r.dataparade.asserts === "dp:scan/entity/data_item:email")).toBe(true);
    expect(JSON.stringify(records)).not.toContain("/Users/");
  });

  it("exports the applied state: overrides in, removed Facts out", () => {
    landReviewAnswer(paths, { target: "cmp_mail", action: "set", property: "name", value: "SendGrid Inc", reviewer: "dev@example.com" });
    landReviewAnswer(paths, { target: "data_item:phone", action: "remove", reviewer: "dev@example.com" });
    exportOcsf(paths, out);
    const { records } = loadOcsfDiscoveriesFromDir(out);
    expect(slot(records, "name")).toContain("SendGrid Inc");
    expect(slot(records, "name")).not.toContain("Sendgrid");
    const asserted = records.map((r) => r.dataparade.asserts);
    expect(asserted.some((a) => a.includes("phone"))).toBe(false);
  });

  it("exports interview answers as interview records that supersede the earlier answer", () => {
    fs.mkdirSync(paths.evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(paths.dir, "evidence/s.md"), "Q/A");
    const { sha } = writeKbBrief(paths);
    const land = (value: string, now: Date) =>
      landInterviewAnswer(paths, { briefSha: sha, target: "flow_mail", slot: "purpose", value, reviewer: "dev@example.com", evidence: "evidence/s.md", skillSha: "f".repeat(40), now });
    land("marketing", new Date("2026-10-10T10:00:00.000Z"));
    land("service_provision", new Date("2026-10-10T11:00:00.000Z"));

    const result = exportOcsf(paths, out);
    expect(result.interviewRecords).toBe(2);
    const interview = loadOcsfDiscoveriesFromDir(out).records.filter((r) => r.dataparade.source === "interview");
    expect(interview.map((r) => r.dataparade.asserted_value).sort()).toEqual(["marketing", "service_provision"]);
    const second = interview.find((r) => r.dataparade.asserted_value === "service_provision");
    expect(second?.dataparade).toMatchObject({ asserts: "dp:scan/entity/flow_mail", reviewer: "dev@example.com", brief_sha: sha, raw_evidence_ref: "evidence/s.md" });
    expect(second?.dataparade.supersedes).toBe(interview.find((r) => r.dataparade.asserted_value === "marketing")?.metadata.uid);
  });

  it("replaces an earlier export and refuses a folder that holds other files", () => {
    exportOcsf(paths, out);
    expect(() => exportOcsf(paths, out)).not.toThrow();
    fs.writeFileSync(path.join(out, "notes.txt"), "mine");
    expect(() => exportOcsf(paths, out)).toThrow(/not OCSF records/);
    expect(fs.existsSync(path.join(out, "notes.txt"))).toBe(true);
  });

  it("refuses to export into the knowledge base folder", () => {
    expect(() => exportOcsf(paths, paths.dir)).toThrow(/separate folder/);
  });
});
