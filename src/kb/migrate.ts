import { createHash } from "crypto";
import path from "path";

import { loadOcsfDiscoveriesFromDir, OcsfDiscoveryLoadError } from "../discoveries/load-ocsf-discoveries";
import { parseScanEntityAsserts } from "../discoveries/scan-entity-uri";
import { appendAnswers, readAnswers } from "../facts/io";
import type { Answer } from "../facts/schema";
import { KbError, type KbPaths } from "./kb-store";

export interface MigrateResult {
  from: string;
  /** Interview records turned into answers. */
  migrated: number;
  /** Interview records already in answers.json from an earlier run. */
  alreadyMigrated: number;
  /** Scan records left behind: a scan regenerates them. */
  scanRecordsDropped: number;
  answerIds: string[];
  dryRun: boolean;
}

/** Same record, same id, so running migrate twice adds nothing. */
export function migratedAnswerId(recordUid: string): string {
  return `ans_${createHash("sha256").update(recordUid).digest("hex").slice(0, 12)}`;
}

function storedValue(slot: string, text: string): unknown {
  if (slot === "data_categories") {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not a list; keep the text.
    }
  }
  return text;
}

/**
 * Convert the interview records in an old `ocsf-discoveries/` folder (CLI 0.0.26 and
 * earlier) into entries of answers.json. Scan records are dropped; scanning again
 * regenerates the Facts. The old folder is left as it is.
 */
export function migrateInterviewRecords(
  paths: KbPaths,
  options: { from?: string; dryRun?: boolean } = {},
): MigrateResult {
  const from = path.resolve(options.from ?? path.join(paths.dir, "ocsf-discoveries"));
  let records;
  try {
    records = loadOcsfDiscoveriesFromDir(from).records;
  } catch (error) {
    if (error instanceof OcsfDiscoveryLoadError) {
      throw new KbError("NOTHING_TO_MIGRATE", `${error.message}. Pass --from <old ocsf-discoveries folder>.`);
    }
    throw error;
  }

  const existing = new Set(readAnswers(paths).answers.map((a) => a.id));
  const fresh: Answer[] = [];
  let alreadyMigrated = 0;
  let scanRecordsDropped = 0;
  for (const record of records) {
    const d = record.dataparade;
    if (d.source !== "interview") {
      if (d.source === "scan") scanRecordsDropped += 1;
      continue;
    }
    if (!d.asserted_slot || d.asserted_value === undefined) continue;
    const id = migratedAnswerId(record.metadata.uid);
    if (existing.has(id)) {
      alreadyMigrated += 1;
      continue;
    }
    existing.add(id);
    fresh.push({
      id,
      factId: parseScanEntityAsserts(d.asserts)?.entityId ?? d.asserts,
      action: "set",
      property: d.asserted_slot,
      value: storedValue(d.asserted_slot, d.asserted_value),
      by: d.reviewer ?? "unknown",
      at: d.reviewed_at ?? d.asserted_at,
      source: "interview",
      ...(d.raw_evidence_ref ? { evidence: d.raw_evidence_ref } : {}),
      ...(d.brief_sha ? { briefSha: d.brief_sha } : {}),
      ...(d.skill_sha ? { skillSha: d.skill_sha } : {}),
    });
  }
  if (!options.dryRun && fresh.length > 0) appendAnswers(paths, fresh);
  return {
    from,
    migrated: fresh.length,
    alreadyMigrated,
    scanRecordsDropped,
    answerIds: fresh.map((a) => a.id),
    dryRun: Boolean(options.dryRun),
  };
}
