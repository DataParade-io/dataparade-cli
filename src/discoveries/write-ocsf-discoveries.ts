import { createHash } from "crypto";
import fs from "fs";
import path from "path";

import { ocsfDiscoveryRecordSchema } from "../../tests/eval/interview-a0/ocsf-discovery-types";
import type { OcsfDiscoveryRecord } from "../../tests/eval/interview-a0/ocsf-discovery-types";

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
