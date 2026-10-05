import type { OrchestratorScanResult as ScannerOrchestratorScanResult } from '@dataparade/scanner';
import type { ScanRedFlag } from '../../ai-enrichment/red-flags';

/**
 * CLI scan result: scanner orchestrator payload plus optional connectivity RED flags
 * collected after deterministic fallbacks / repair (soft gate; JSON still written).
 */
export type OrchestratorScanResult = ScannerOrchestratorScanResult & {
  redFlags?: ScanRedFlag[];
};
