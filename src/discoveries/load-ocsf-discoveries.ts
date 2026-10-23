import fs from "fs";
import path from "path";

import {
  ocsfDiscoveryRecordSchema,
  type OcsfDiscoveryRecord,
} from "./contract/ocsf-discovery-record";

export class OcsfDiscoveryLoadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OcsfDiscoveryLoadError";
  }
}

export interface LoadedOcsfDiscoveries {
  directory: string;
  records: OcsfDiscoveryRecord[];
}

export interface LoadOcsfDiscoveriesOptions {
  /**
   * When set, every interview record must carry this `brief_sha`. The A0 eval
   * passes its pinned dogfood brief; live sessions leave it unset because each
   * answer pins the KB snapshot it was asked from.
   */
  requiredBriefSha?: string;
}

export function loadOcsfDiscoveriesFromDir(
  directory: string,
  options: LoadOcsfDiscoveriesOptions = {},
): LoadedOcsfDiscoveries {
  const resolved = path.resolve(directory);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new OcsfDiscoveryLoadError("MISSING_DIRECTORY", `OCSF directory not found: ${resolved}`);
  }

  const files = fs
    .readdirSync(resolved)
    .filter((name) => name.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    throw new OcsfDiscoveryLoadError("EMPTY_DIRECTORY", `No OCSF JSON files in ${resolved}`);
  }

  const records: OcsfDiscoveryRecord[] = [];
  for (const file of files) {
    const filePath = path.join(resolved, file);
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    const record = ocsfDiscoveryRecordSchema.parse(parsed);
    if (
      options.requiredBriefSha &&
      record.dataparade.source === "interview" &&
      record.dataparade.brief_sha !== options.requiredBriefSha
    ) {
      throw new OcsfDiscoveryLoadError(
        "PIN_MISMATCH",
        `${file}: brief_sha ${record.dataparade.brief_sha} != pin ${options.requiredBriefSha}`,
      );
    }
    records.push(record);
  }

  return { directory: resolved, records };
}
