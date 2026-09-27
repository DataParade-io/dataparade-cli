import fs from "fs";
import path from "path";

import { ocsfDiscoveryRecordSchema } from "../../tests/eval/interview-a0/ocsf-discovery-types";
import type { OcsfDiscoveryRecord } from "../../tests/eval/interview-a0/ocsf-discovery-types";

export function slugifyDiscoveryId(id: string): string {
  return id.replace(/[:/]/g, "_");
}

function ocsfDiscoveryPath(outputDir: string, discoveryId: string): string {
  return path.join(outputDir, `${slugifyDiscoveryId(discoveryId)}.json`);
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
