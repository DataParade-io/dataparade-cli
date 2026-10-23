import fs from "fs";
import os from "os";
import path from "path";

import { landScanDiscoveryToOcsfRecords } from "../../../src/discoveries/scan-discovery-to-ocsf";
import { scanEntityAsserts } from "../../../src/discoveries/scan-entity-uri";
import { writeOcsfDiscoveryRecordsToDir } from "../../../src/discoveries/write-ocsf-discoveries";
import { readAnswers } from "../../../src/facts/io";
import { buildInterviewOcsfRecord } from "../../../src/kb/interview-record";
import { loadKbState } from "../../../src/kb/kb-store";
import { migrateInterviewRecords } from "../../../src/kb/migrate";
import { makeKbDir } from "../../helpers/facts-fixture";

const SCAN_PATH = "/Users/dev/repo";
const SHA = "a".repeat(40);

/** What CLI 0.0.26 left in ocsf-discoveries/: scan records and interview records. */
function writeOldFolder(dir: string) {
  const scan = landScanDiscoveryToOcsfRecords(
    {
      scanPath: SCAN_PATH,
      components: [{ id: "cmp_mail", name: "Sendgrid", type: "third_party", subType: "email", confidence: 0.9, sourceLocations: [] }],
      dataFlows: [],
      occurrences: [],
      dataItems: [],
    },
    { assertedAt: "2026-10-09T00:00:00.000Z" },
  );
  const interview = (id: string, factId: string, slot: "purpose" | "data_categories", value: unknown, at: string) => {
    const record = buildInterviewOcsfRecord({
      uid: `dp:discovery/interview/${id}`,
      answer: { id, factId, action: "set", property: slot, value, by: "dev@example.com", at, source: "interview", evidence: "evidence/session.md" },
      slot,
      briefSha: SHA,
      skillSha: SHA,
    });
    const asserts = scanEntityAsserts(SCAN_PATH, factId);
    return { ...record, resources: [{ ...record.resources![0], uid: asserts }], dataparade: { ...record.dataparade, asserts } };
  };
  writeOcsfDiscoveryRecordsToDir(
    [
      ...scan,
      interview("flow_mail_purpose_20261009", "flow_mail", "purpose", "marketing", "2026-10-09T10:00:00.000Z"),
      interview("flow_mail_categories_20261009", "flow_mail", "data_categories", '["contact"]', "2026-10-09T11:00:00.000Z"),
    ],
    dir,
  );
}

describe("kb migrate", () => {
  let paths: ReturnType<typeof makeKbDir>;
  let oldDir: string;
  beforeEach(() => {
    paths = makeKbDir();
    oldDir = path.join(paths.dir, "ocsf-discoveries");
    writeOldFolder(oldDir);
  });
  afterEach(() => fs.rmSync(paths.dir, { recursive: true, force: true }));

  it("turns interview records into answers and drops scan records", () => {
    const result = migrateInterviewRecords(paths);
    expect(result).toMatchObject({ migrated: 2, alreadyMigrated: 0, dryRun: false });
    expect(result.scanRecordsDropped).toBeGreaterThan(0);

    const answers = readAnswers(paths).answers;
    expect(answers).toHaveLength(2);
    const purpose = answers.find((a) => a.property === "purpose");
    expect(purpose).toMatchObject({
      factId: "flow_mail",
      action: "set",
      value: "marketing",
      by: "dev@example.com",
      at: "2026-10-09T10:00:00.000Z",
      source: "interview",
      evidence: "evidence/session.md",
      briefSha: SHA,
      skillSha: SHA,
    });
    expect(answers.find((a) => a.property === "data_categories")?.value).toEqual(["contact"]);
    expect(JSON.stringify(answers)).not.toContain(SCAN_PATH);
  });

  it("makes the old answers show up in the applied state", () => {
    migrateInterviewRecords(paths);
    const flow = loadKbState(paths).applied.facts.dataFlows.find((f) => f.id === "flow_mail") as Record<string, unknown>;
    expect(flow.purpose).toBe("marketing");
    expect(flow.data_categories).toEqual(["contact"]);
  });

  it("is safe to run twice", () => {
    migrateInterviewRecords(paths);
    const again = migrateInterviewRecords(paths);
    expect(again).toMatchObject({ migrated: 0, alreadyMigrated: 2 });
    expect(readAnswers(paths).answers).toHaveLength(2);
  });

  it("writes nothing on --dry-run, and leaves the old folder alone", () => {
    const before = fs.readdirSync(oldDir).length;
    expect(migrateInterviewRecords(paths, { dryRun: true })).toMatchObject({ migrated: 2, dryRun: true });
    expect(fs.existsSync(paths.answersPath)).toBe(false);
    expect(fs.readdirSync(oldDir)).toHaveLength(before);
  });

  it("reads from another folder", () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "dp-old-"));
    try {
      writeOldFolder(elsewhere);
      fs.rmSync(oldDir, { recursive: true });
      expect(migrateInterviewRecords(paths, { from: elsewhere }).migrated).toBe(2);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("says what is missing when there is no old folder", () => {
    fs.rmSync(oldDir, { recursive: true });
    expect(() => migrateInterviewRecords(paths)).toThrow(/--from/);
  });
});
