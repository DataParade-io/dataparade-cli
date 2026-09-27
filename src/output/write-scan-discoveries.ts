import fs from "fs";
import path from "path";

import type { OrchestratorScanResult } from "../core/pipeline/orchestrator-result";
import { loadOcsfDiscoveriesFromDir } from "../discoveries/load-ocsf-discoveries";
import { projectCollectedDiscoveriesDiagram } from "../discoveries/project-collected-diagram";
import { projectOcsfToDiscoveriesDocument } from "../discoveries/project-ocsf-to-discoveries-document";
import { orchestratorScanResultToDiscoveryInput } from "../discoveries/scan-result-to-discovery-input";
import { landScanDiscoveryToOcsfRecords } from "../discoveries/scan-discovery-to-ocsf";
import { writeOcsfDiscoveryRecordsToDir } from "../discoveries/write-ocsf-discoveries";

export const SCAN_OCSF_DISCOVERIES_DIRNAME = "ocsf-discoveries";
export const SCAN_DATAPARADE_JSON_BASENAME = "dataparade.json";
export const SCAN_COLLECTED_DIAGRAM_JSON_BASENAME = "discoveries-diagram.json";
export const SCAN_COLLECTED_DIAGRAM_D2_BASENAME = "discoveries-diagram.d2";

export interface ScanDiscoveriesOutputPaths {
  ocsfDiscoveriesDir: string;
  dataparadeJsonPath: string;
  collectedDiagramJsonPath: string;
  collectedDiagramD2Path: string;
}

export function resolveScanDiscoveriesOutputPaths(dataflowOutputPath: string): ScanDiscoveriesOutputPaths {
  const outputDir = path.dirname(path.resolve(dataflowOutputPath));
  return {
    ocsfDiscoveriesDir: path.join(outputDir, SCAN_OCSF_DISCOVERIES_DIRNAME),
    dataparadeJsonPath: path.join(outputDir, SCAN_DATAPARADE_JSON_BASENAME),
    collectedDiagramJsonPath: path.join(outputDir, SCAN_COLLECTED_DIAGRAM_JSON_BASENAME),
    collectedDiagramD2Path: path.join(outputDir, SCAN_COLLECTED_DIAGRAM_D2_BASENAME),
  };
}

export interface WriteScanDiscoveriesOptions {
  assertedAt?: string;
  scanRootDir: string;
}

export function writeScanDiscoveriesArtifacts(
  scanResult: OrchestratorScanResult,
  dataflowOutputPath: string,
  options: WriteScanDiscoveriesOptions,
): ScanDiscoveriesOutputPaths {
  const assertedAt = options.assertedAt ?? new Date().toISOString();
  const discoveryInput = {
    ...orchestratorScanResultToDiscoveryInput(scanResult),
    scanPath: options.scanRootDir,
  };
  const scanRecords = landScanDiscoveryToOcsfRecords(discoveryInput, { assertedAt });

  const paths = resolveScanDiscoveriesOutputPaths(dataflowOutputPath);
  writeOcsfDiscoveryRecordsToDir(scanRecords, paths.ocsfDiscoveriesDir);

  const loaded = loadOcsfDiscoveriesFromDir(paths.ocsfDiscoveriesDir);
  const document = projectOcsfToDiscoveriesDocument({ records: loaded.records });
  fs.writeFileSync(paths.dataparadeJsonPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  const collected = projectCollectedDiscoveriesDiagram(document);
  fs.writeFileSync(
    paths.collectedDiagramJsonPath,
    `${JSON.stringify(collected.graph, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(paths.collectedDiagramD2Path, collected.d2, "utf8");

  return paths;
}
