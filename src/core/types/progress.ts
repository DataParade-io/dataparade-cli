export type ScanPhase =
  | "idle"
  | "ingest"
  | "analyze"
  | "classify"
  | "data_flow"
  | "ai_enrichment"
  | "output";

export interface ScanProgress {
  phase: ScanPhase;
  currentFile?: string;
  filesProcessed: number;
  totalFiles: number;
  progress: number;
  message?: string;
}

