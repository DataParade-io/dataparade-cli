import fs from "fs";
import os from "os";
import path from "path";

import { writeOcsfDiscoveryRecordsToDir } from "../../../src/discoveries/write-ocsf-discoveries";
import { landScanDiscoveryToOcsfRecords } from "../../../src/discoveries/scan-discovery-to-ocsf";
import { loadOcsfDiscoveriesFromDir } from "../../../src/discoveries/load-ocsf-discoveries";

describe("OCSF discovery files for long ids", () => {
  it("keeps file names under the filesystem limit and loads every record back", () => {
    const scanPath = `/Users/someone/${"deeply-nested-checkout/".repeat(8)}repo`;
    const occurrence = {
      id: `occurrence:phone_number:${"app/actions/contact/".repeat(4)}identify_action.rb:13`,
      filePath: "app/actions/contact/identify_action.rb",
      startLine: 13,
      endLine: 13,
      labels: ["phone_number"],
    };
    const records = landScanDiscoveryToOcsfRecords(
      {
        scanPath,
        components: [],
        dataFlows: [],
        occurrences: [occurrence],
        dataItems: [{ id: "data_item:phone_number", occurrenceIds: [occurrence.id], labels: ["phone_number"] }],
      },
      { assertedAt: "2026-10-05T00:00:00.000Z" },
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-ocsf-long-"));
    try {
      const written = writeOcsfDiscoveryRecordsToDir(records, dir);
      expect(written).toHaveLength(records.length);
      for (const file of written) expect(path.basename(file).length).toBeLessThanOrEqual(205);
      expect(new Set(written).size).toBe(written.length);
      expect(loadOcsfDiscoveriesFromDir(dir).records).toHaveLength(records.length);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
