import fs from "fs";
import path from "path";

import type { OcsfDiscoveryRecord } from "../discoveries/contract/ocsf-discovery-record";
import type { A0DiscoveriesDocument } from "../discoveries/contract/discoveries-document.schema";
import {
  loadOcsfDiscoveriesFromDir,
  OcsfDiscoveryLoadError,
} from "../discoveries/load-ocsf-discoveries";
import { projectOcsfToDiscoveriesDocument } from "../discoveries/project-ocsf-to-discoveries-document";
import { SCAN_OCSF_DISCOVERIES_DIRNAME } from "../output/write-scan-discoveries";

/**
 * A project knowledge base on disk: the directory a scan wrote `dataflow.json`
 * into (`dataparade scan <repo> -o <kb>/dataflow.json`).
 *
 *   <kb>/ocsf-discoveries/  Discovery records (scan + interview), one OCSF file each
 *   <kb>/briefs/<sha>.json  KB snapshots that interview questions were asked from
 *   <kb>/evidence/          unedited interview transcripts
 *   <kb>/diagram.json       latest projection for the viewer
 */
export interface KbPaths {
  root: string;
  discoveriesDir: string;
  briefsDir: string;
  evidenceDir: string;
  diagramPath: string;
}

export function resolveKbPaths(kbDir: string): KbPaths {
  const root = path.resolve(kbDir);
  return {
    root,
    discoveriesDir: path.join(root, SCAN_OCSF_DISCOVERIES_DIRNAME),
    briefsDir: path.join(root, "briefs"),
    evidenceDir: path.join(root, "evidence"),
    diagramPath: path.join(root, "diagram.json"),
  };
}

export class KbError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KbError";
  }
}

export function loadKbRecords(paths: KbPaths): OcsfDiscoveryRecord[] {
  try {
    return loadOcsfDiscoveriesFromDir(paths.discoveriesDir).records;
  } catch (error) {
    if (error instanceof OcsfDiscoveryLoadError && ["EMPTY_DIRECTORY", "MISSING_DIRECTORY"].includes(error.code)) {
      throw new KbError(
        "NO_KB",
        `No knowledge base at ${paths.root}. Scan first: dataparade scan <repo> -o ${path.join(paths.root, "dataflow.json")}`,
      );
    }
    throw error;
  }
}

export interface KbState {
  records: OcsfDiscoveryRecord[];
  document: A0DiscoveriesDocument;
  /** Interview answers about entities the latest scan no longer has. Kept on disk, not projected. */
  orphans: OcsfDiscoveryRecord[];
}

export function loadKbState(paths: KbPaths): KbState {
  const records = loadKbRecords(paths);
  const orphans: OcsfDiscoveryRecord[] = [];
  const document = projectOcsfToDiscoveriesDocument({
    records,
    orphanInterviewRecords: "skip",
    onOrphanInterviewRecord: (record) => orphans.push(record),
  });
  return { records, document, orphans };
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
