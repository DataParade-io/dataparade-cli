import { createHash } from "crypto";
import fs from "fs";
import path from "path";

import { ocsfDiscoveryRecordSchema } from "./contract/ocsf-discovery-record";
import type { OcsfDiscoveryRecord } from "./contract/ocsf-discovery-record";
import { parseScanEntityAsserts } from "./scan-entity-uri";

export function slugifyDiscoveryId(id: string): string {
  return id.replace(/[:/]/g, "_");
}

/** File names stay well under the 255-byte limit of common filesystems. */
const MAX_SLUG_LENGTH = 200;

/**
 * The record's file. A long id (a deep scan path plus an occurrence's file and line)
 * keeps a readable prefix and ends in a hash of the whole id; loaders read the id from
 * the record, not the name.
 */
function ocsfDiscoveryPath(outputDir: string, discoveryId: string): string {
  const slug = slugifyDiscoveryId(discoveryId);
  if (slug.length <= MAX_SLUG_LENGTH) {
    return path.join(outputDir, `${slug}.json`);
  }
  const hash = createHash("sha256").update(discoveryId).digest("hex").slice(0, 16);
  return path.join(outputDir, `${slug.slice(0, MAX_SLUG_LENGTH - hash.length - 1)}_${hash}.json`);
}

export function writeOcsfDiscoveryRecordsToDir(
  records: OcsfDiscoveryRecord[],
  outputDir: string,
): string[] {
  const resolved = path.resolve(outputDir);
  fs.mkdirSync(resolved, { recursive: true });

  const writtenPaths: string[] = [];
  for (const record of records) {
    const validated = ocsfDiscoveryRecordSchema.parse(record);
    const discoveryId = validated.metadata.uid;
    const filePath = ocsfDiscoveryPath(resolved, discoveryId);
    if (fs.existsSync(filePath)) {
      throw new Error(`OCSF Discovery record already exists: ${filePath}`);
    }
    fs.writeFileSync(filePath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    writtenPaths.push(filePath);
  }

  return writtenPaths;
}

/**
 * A re-scan replaces that scan path's earlier scan records: the scan is the
 * source of truth for what it found, and its records carry the land date in
 * their ids, so an append would collide on the same day and pile up across days.
 * Interview and cloud records, and scan records for other scan paths, are kept.
 * Returns the paths it removed.
 */
export function removeScanRecordsForScanPath(outputDir: string, scanPath: string): string[] {
  const resolved = path.resolve(outputDir);
  if (!fs.existsSync(resolved)) {
    return [];
  }
  const removed: string[] = [];
  for (const name of fs.readdirSync(resolved)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(resolved, name);
    let record: { dataparade?: { source?: string; asserts?: string } };
    try {
      record = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    const asserts = record.dataparade?.asserts;
    if (record.dataparade?.source !== "scan" || !asserts) {
      continue;
    }
    if (parseScanEntityAsserts(asserts)?.scanPath === scanPath) {
      fs.rmSync(filePath);
      removed.push(filePath);
    }
  }
  return removed;
}
