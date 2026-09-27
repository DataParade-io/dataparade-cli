import fs from "fs";
import os from "os";
import path from "path";

import { landScanDiscoveryToOcsfRecords } from "../../../src/discoveries/scan-discovery-to-ocsf";
import { discoverySeedToDiscoveryInput } from "../../../src/discoveries/scan-result-to-discovery-input";
import { loadDiscoverySeedFromFile } from "../../eval/a0-diagram/load-discovery-seed";
import { gapsFromOcsfDir } from "../../eval/interview-a0/gaps-from-ocsf";

const DOGFOOD_OCSF_DIR =
  "/Users/home/Projects/knowledge-base/project/wiki/graph/dogfood/ocsf-discoveries";

const DISCOVERY_SEED_PATH = path.join(
  __dirname,
  "../../eval/a0-diagram/fixtures/dataparade-discovery-seed.json",
);

function copyDogfoodWithScanSeed(sourceDir: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gaps-dogfood-"));
  for (const file of fs.readdirSync(sourceDir).filter((name) => name.endsWith(".json"))) {
    fs.copyFileSync(path.join(sourceDir, file), path.join(tempDir, file));
  }

  const hasScan = fs
    .readdirSync(tempDir)
    .some((file) => {
      const record = JSON.parse(fs.readFileSync(path.join(tempDir, file), "utf8")) as {
        dataparade?: { source?: string };
      };
      return record.dataparade?.source === "scan";
    });

  if (!hasScan) {
    const seed = loadDiscoverySeedFromFile(DISCOVERY_SEED_PATH);
    const scanRecords = landScanDiscoveryToOcsfRecords(discoverySeedToDiscoveryInput(seed));
    for (const record of scanRecords) {
      const fileName = `${record.metadata.uid.replace(/[:/]/g, "_")}.json`;
      fs.writeFileSync(path.join(tempDir, fileName), `${JSON.stringify(record, null, 2)}\n`, "utf8");
    }
  }

  return tempDir;
}

const dogfoodExists = fs.existsSync(DOGFOOD_OCSF_DIR);
const describeDogfood = dogfoodExists ? describe : describe.skip;

describeDogfood("gapsFromOcsfDir (dogfood OCSF store)", () => {
  if (!dogfoodExists) {
    it("skipped — dogfood OCSF directory missing", () => {
      throw new Error(`Dogfood OCSF directory missing: ${DOGFOOD_OCSF_DIR}`);
    });
    return;
  }

  it("derives snapshot and gaps from dogfood interview overlay + scan seed", () => {
    const dir = copyDogfoodWithScanSeed(DOGFOOD_OCSF_DIR);
    const report = gapsFromOcsfDir(dir);

    expect(report.snapshot.scanKnownFlows).toContain("flow_103");
    expect(report.snapshot.sha).toMatch(/^[0-9a-f]{64}$/);
    expect(
      report.gaps.some(
        (gap) => gap.entityId === "flow_103" && gap.slot === "sends_data_to.endpoint",
      ),
    ).toBe(false);
  });
});
