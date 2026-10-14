import type { DetectedComponent, RawFinding } from '../core/types';

export type ScanUiStepId =
  | 'scanning_files'
  | 'analyzing'
  | 'detecting_frameworks'
  | 'mapping_data_stores'
  | 'finding_outbound'
  | 'ai_enrichment';

/** What the AI step changed, for its one-line result. */
export interface ScanAiStepResult {
  proposalsApplied: number;
}

export interface ScanRecognitionPayload {
  findings: RawFinding[];
  components: DetectedComponent[];
}

export interface ScanProgressRendererOptions {
  /** When false, plain logs only (no Clack spinner / intro chrome). */
  isTTY: boolean;
  /** When true, never emit ANSI escape codes. */
  noColor: boolean;
  /** CLI version shown in the brand header. */
  version?: string;
  /** Terminal width (defaults to process.stdout.columns). */
  columns?: number;
  /** Terminal color depth in bits (defaults to process.stdout.getColorDepth()). */
  colorDepth?: number;
  /** Short path/name shown under the brand header. */
  projectLabel?: string;
  /** Override stdout writes (tests). Defaults to console.log. */
  writeLine?: (line: string) => void;
  /** Injected Clack module. Tests pass a mock; production loads the ESM package. */
  prompts?: typeof import('@clack/prompts');
}

export interface TeachingLineGroups {
  routes: string[];
  stores: string[];
  outbound: string[];
}
