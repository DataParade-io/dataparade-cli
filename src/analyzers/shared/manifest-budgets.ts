export interface ManifestScanBudgetOptions {
  maxManifestFiles?: number;
  maxTotalManifestReadBytes?: number;
  maxManifestFileSizeBytes?: number;
  excludePaths?: string[];
  onWarning?: (msg: string) => void;
}

export type BudgetState = {
  maxManifestFiles: number;
  maxTotalManifestReadBytes: number;
  maxManifestFileSizeBytes: number;
  onWarning?: (msg: string) => void;
  manifestFiles: number;
  totalReadBytes: number;
  stopped: boolean;
  warned: boolean;
};

export const DEFAULT_BUDGETS: Required<
  Pick<
    ManifestScanBudgetOptions,
    "maxManifestFiles" | "maxTotalManifestReadBytes" | "maxManifestFileSizeBytes"
  >
> = {
  maxManifestFiles: 500,
  maxTotalManifestReadBytes: 5 * 1024 * 1024, // 5MB
  maxManifestFileSizeBytes: 250 * 1024, // 250KB
};

export function budgetStateFromOptions(
  opts?: ManifestScanBudgetOptions,
): BudgetState {
  return {
    maxManifestFiles: opts?.maxManifestFiles ?? DEFAULT_BUDGETS.maxManifestFiles,
    maxTotalManifestReadBytes:
      opts?.maxTotalManifestReadBytes ?? DEFAULT_BUDGETS.maxTotalManifestReadBytes,
    maxManifestFileSizeBytes:
      opts?.maxManifestFileSizeBytes ?? DEFAULT_BUDGETS.maxManifestFileSizeBytes,
    onWarning: opts?.onWarning,
    manifestFiles: 0,
    totalReadBytes: 0,
    stopped: false,
    warned: false,
  };
}

