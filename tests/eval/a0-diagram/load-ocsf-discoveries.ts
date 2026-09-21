import fs from "fs";
import path from "path";

import {
  ocsfDiscoveryRecordSchema,
  type OcsfDiscoveryRecord,
} from "../interview-a0/ocsf-discovery-types";
import { PINNED_BRIEF_SHA } from "../interview-a0/pins";

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

export function loadOcsfDiscoveriesFromDir(directory: string): LoadedOcsfDiscoveries {
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
    if (record.dataparade.brief_sha !== PINNED_BRIEF_SHA) {
      throw new OcsfDiscoveryLoadError(
        "PIN_MISMATCH",
        `${file}: brief_sha ${record.dataparade.brief_sha} != pin ${PINNED_BRIEF_SHA}`,
      );
    }
    records.push(record);
  }

  return { directory: resolved, records };
}

export type DiscoverySlotIndex = Map<string, Map<string, string>>;

export function indexDiscoverySlots(records: OcsfDiscoveryRecord[]): DiscoverySlotIndex {
  const index: DiscoverySlotIndex = new Map();
  for (const record of records) {
    const slot = record.dataparade.asserted_slot;
    if (!slot) {
      continue;
    }
    const asserts = record.dataparade.asserts;
    const bySlot = index.get(asserts) ?? new Map<string, string>();
    bySlot.set(slot, record.dataparade.asserted_value ?? "");
    index.set(asserts, bySlot);
  }
  return index;
}

export function discoveryValue(
  index: DiscoverySlotIndex,
  asserts: string,
  slot: string,
): string | undefined {
  return index.get(asserts)?.get(slot);
}
