import fs from "fs";
import path from "path";

import type { OcsfDiscoveryRecord } from "../discoveries/contract/ocsf-discovery-record";
import type { ScanDiscoveryInput } from "../discoveries/scan-discovery-input";
import { landScanDiscoveryToOcsfRecords } from "../discoveries/scan-discovery-to-ocsf";
import { writeOcsfDiscoveryRecordsToDir } from "../discoveries/write-ocsf-discoveries";
import type { AppliedState } from "../facts/apply-answers";
import { buildInterviewOcsfRecord, interviewRecordUid } from "../kb/interview-record";
import { loadKbState, type KbPaths } from "../kb/kb-store";
import { isInterviewSlot } from "../kb/slot-shapes";

/** Used when an interview answer has no brief or skill SHA (it was not landed by `kb land`). */
const NO_SHA = "0".repeat(40);

/** The applied state in the shape the OCSF record builders read. */
export function appliedStateToScanInput(applied: AppliedState): ScanDiscoveryInput {
  return {
    components: applied.facts.components.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      subType: c.subType,
      confidence: c.confidence,
      sourceLocations: c.sourceLocations,
    })),
    dataFlows: applied.facts.dataFlows.map((f) => ({
      id: f.id,
      sourceComponentId: f.sourceComponentId,
      targetComponentId: f.targetComponentId,
      type: f.type,
      confidence: f.confidence,
      ...(f.targetScope !== undefined ? { targetScope: f.targetScope } : {}),
    })),
    occurrences: applied.dataItemFiles.flatMap((file) =>
      file.occurrences.map((o) => ({
        id: o.id,
        filePath: o.filePath,
        startLine: o.startLine,
        endLine: o.endLine,
        ...(o.code !== undefined ? { code: o.code } : {}),
        labels: o.labels,
      })),
    ),
    dataItems: applied.dataItemFiles.map((file) => ({
      id: file.id,
      occurrenceIds: file.occurrences.map((o) => o.id),
      labels: file.labels,
    })),
  };
}

export interface ExportOcsfResult {
  outDir: string;
  records: number;
  scanRecords: number;
  interviewRecords: number;
}

/**
 * Write the knowledge base as OCSF Architecture Discovery records: the scan's Facts with
 * the answers applied, plus one interview record for each interview answer that is still
 * current. This is the only producer of OCSF records; the folder it writes is an export,
 * not storage.
 */
export function exportOcsf(paths: KbPaths, outDir: string): ExportOcsfResult {
  const state = loadKbState(paths);
  const resolvedOut = path.resolve(outDir);
  if (resolvedOut === paths.dir || resolvedOut === path.dirname(paths.dir)) {
    throw new Error(`--out must be a separate folder, not ${resolvedOut}.`);
  }

  const scanRecords = landScanDiscoveryToOcsfRecords(appliedStateToScanInput(state.applied), {
    assertedAt: state.facts.scan.scannedAt,
  });

  const interviewRecords: OcsfDiscoveryRecord[] = [];
  const previous = new Map<string, string>();
  const appliedIds = new Set(state.applied.applied.map((a) => a.id));
  const ordered = [...state.answers].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const answer of ordered) {
    if (answer.source !== "interview" || answer.action !== "set" || !answer.property) continue;
    if (!appliedIds.has(answer.id) || !isInterviewSlot(answer.property)) continue;
    const key = `${answer.factId}\u0000${answer.property}`;
    const uid = interviewRecordUid(answer.id);
    interviewRecords.push(
      buildInterviewOcsfRecord({
        uid,
        answer,
        slot: answer.property,
        briefSha: answer.briefSha ?? NO_SHA,
        skillSha: answer.skillSha ?? NO_SHA,
        supersedes: previous.get(key),
      }),
    );
    previous.set(key, uid);
  }

  // An earlier export is replaced; anything else in the folder is not ours to delete.
  if (fs.existsSync(resolvedOut)) {
    const entries = fs.readdirSync(resolvedOut);
    const foreign = entries.filter((name) => !name.endsWith(".json"));
    if (foreign.length > 0) {
      throw new Error(`${resolvedOut} holds files that are not OCSF records (${foreign[0]}); pick an empty folder.`);
    }
    for (const name of entries) fs.rmSync(path.join(resolvedOut, name));
  }
  writeOcsfDiscoveryRecordsToDir([...scanRecords, ...interviewRecords], resolvedOut);
  return {
    outDir: resolvedOut,
    records: scanRecords.length + interviewRecords.length,
    scanRecords: scanRecords.length,
    interviewRecords: interviewRecords.length,
  };
}
