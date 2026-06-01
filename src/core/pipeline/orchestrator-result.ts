import type { FileInfo, RawFinding, ScanResult } from "../types";

export interface OrchestratorScanResult {
  scanResult: ScanResult;
  files: FileInfo[];
  findings: RawFinding[];
}
