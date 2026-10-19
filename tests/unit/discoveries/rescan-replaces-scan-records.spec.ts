import fs from "fs";
import os from "os";
import path from "path";

import type { OcsfDiscoveryRecord } from "../../../src/discoveries/contract/ocsf-discovery-record";
import { loadOcsfDiscoveriesFromDir } from "../../../src/discoveries/load-ocsf-discoveries";
import { landScanDiscoveryToOcsfRecords } from "../../../src/discoveries/scan-discovery-to-ocsf";
import { scanEntityAsserts } from "../../../src/discoveries/scan-entity-uri";
import {
  removeScanRecordsForScanPath,
  writeOcsfDiscoveryRecordsToDir,
} from "../../../src/discoveries/write-ocsf-discoveries";

const ASSERTED_AT = "2026-10-09T00:00:00.000Z";
const SHA = "a".repeat(40);

function scanRecords(scanPath: string, componentName: string, subType = "") {
  return landScanDiscoveryToOcsfRecords(
    {
      scanPath,
      components: [
        { id: "cmp_api", name: componentName, type: "asset", subType, confidence: 0.9, sourceLocations: [] },
        { id: "cmp_mail", name: "Sendgrid", type: "third_party", subType: "email", confidence: 0.9, sourceLocations: [] },
      ],
      dataFlows: [
        { id: "flow_mail", sourceComponentId: "cmp_api", targetComponentId: "cmp_mail", type: "api_call", confidence: 0.9 },
      ],
      occurrences: [],
      dataItems: [],
    },
    { assertedAt: ASSERTED_AT },
  );
}

/** An interview answer about `flow_mail` under `scanPath`, as the live write-back lands it. */
function interviewRecord(scanPath: string): OcsfDiscoveryRecord {
  const asserts = scanEntityAsserts(scanPath, "flow_mail");
  const base = scanRecords(scanPath, "API")[0];
  return {
    ...base,
    metadata: { ...base.metadata, uid: `dp:discovery/interview/flow_mail/purpose/20261009` },
    resources: [{ uid: asserts, name: "flow_mail", type: "entity" }],
    dataparade: {
      record_kind: "discovery",
      ontology_version: base.dataparade.ontology_version,
      source: "interview",
      asserted_at: ASSERTED_AT,
      asserts,
      asserted_slot: "purpose",
      asserted_value: "service_provision",
      eligible_shape: "D8",
      raw_evidence_ref: "sessions/2026-10-09-interview.md",
      reviewer: "dev@example.com",
      reviewed_at: ASSERTED_AT,
      brief_sha: SHA,
      skill_sha: SHA,
    },
  };
}

describe("re-scanning into an existing discoveries directory", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-ocsf-rescan-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("replaces that scan path's scan records and keeps interview records and other scan paths", () => {
    writeOcsfDiscoveryRecordsToDir(scanRecords("/repo/a", "API"), dir);
    writeOcsfDiscoveryRecordsToDir(scanRecords("/repo/b", "Other API"), dir);
    writeOcsfDiscoveryRecordsToDir([interviewRecord("/repo/a")], dir);

    // Same day, same scan path: without the replace step this collides on ids.
    removeScanRecordsForScanPath(dir, "/repo/a");
    expect(() => writeOcsfDiscoveryRecordsToDir(scanRecords("/repo/a", "API (renamed)"), dir)).not.toThrow();

    const records = loadOcsfDiscoveriesFromDir(dir).records;
    const names = records
      .filter((r) => r.dataparade.source === "scan" && r.dataparade.asserted_slot === "name")
      .map((r) => r.dataparade.asserted_value)
      .sort();
    expect(names).toEqual(["API (renamed)", "Other API", "Sendgrid", "Sendgrid"]);
    const interview = records.filter((r) => r.dataparade.source === "interview");
    expect(interview).toHaveLength(1);
    expect(interview[0].dataparade.asserted_value).toBe("service_provision");
  });

  it("writes no sub_type slot for a component without a subtype", () => {
    const records = scanRecords("/repo/a", "API", "");
    const apiAsserts = scanEntityAsserts("/repo/a", "cmp_api");
    const slots = records.filter((r) => r.dataparade.asserts === apiAsserts).map((r) => r.dataparade.asserted_slot);
    expect(slots).not.toContain("sub_type");
    expect(() => writeOcsfDiscoveryRecordsToDir(records, dir)).not.toThrow();
  });

  it("accepts any full SHA for brief_sha on interview records, and lets callers pin one", () => {
    writeOcsfDiscoveryRecordsToDir([interviewRecord("/repo/a")], dir);
    expect(loadOcsfDiscoveriesFromDir(dir).records).toHaveLength(1);
    expect(() => loadOcsfDiscoveriesFromDir(dir, { requiredBriefSha: "b".repeat(40) })).toThrow(/PIN|brief_sha/);
  });
});
