import type { ScanConfiguration } from "../core/types";

/** Redact secret fields before printing configuration to stdout. */
export function redactScanConfigurationForDisplay(
  config: ScanConfiguration,
): ScanConfiguration {
  const redacted: ScanConfiguration = { ...config };
  if (config.aiApiKey?.trim()) {
    redacted.aiApiKey = "<redacted>";
  }
  if (config.workspaceApiKey?.trim()) {
    redacted.workspaceApiKey = "<redacted>";
  }
  return redacted;
}
