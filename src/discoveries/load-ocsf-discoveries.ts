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

export type DiscoverySlotIndex = Map<string, Map<string, string>>;

/**
 * Latest value per (asserts, slot). A record named in another record's
 * `supersedes` is a corrected answer and drops out; the rest apply in
 * `asserted_at` order (stable, so same-instant records keep load order).
 */
export function indexDiscoverySlots(records: OcsfDiscoveryRecord[]): DiscoverySlotIndex {
  const superseded = new Set(
    records.map((record) => record.dataparade.supersedes).filter((uid): uid is string => Boolean(uid)),
  );
  const ordered = records
    .filter((record) => !superseded.has(record.metadata.uid))
    .map((record, position) => ({ record, position }))
    .sort(
      (a, b) =>
        Date.parse(a.record.dataparade.asserted_at) - Date.parse(b.record.dataparade.asserted_at) ||
        a.position - b.position,
    )
    .map(({ record }) => record);
  const index: DiscoverySlotIndex = new Map();
  for (const record of ordered) {
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
