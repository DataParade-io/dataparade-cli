import type { ScanConfiguration } from "../core/types";

export function validateAiInferenceCredentials(
  config: ScanConfiguration,
): string[] {
  const errors: string[] = [];
  if (!config.enableAiInference) return errors;

  const hasByok =
    Boolean(config.aiProvider?.trim()) &&
    Boolean(config.aiModel?.trim()) &&
    Boolean(config.aiApiKey?.trim());
  const hasWorkspace = Boolean(config.workspaceApiKey?.trim());

  if (hasByok && hasWorkspace) {
    errors.push(
      "ai-inference: set either SCAN_BYOK_* (your LLM provider) or DATAPARADE_WORKSPACE_API_KEY (platform AI), not both",
    );
    return errors;
  }

  if (!hasByok && !hasWorkspace) {
    errors.push(
      "ai-inference: LLM inference requires SCAN_BYOK_PROVIDER, SCAN_BYOK_MODEL, and SCAN_BYOK_API_KEY, or DATAPARADE_WORKSPACE_API_KEY for platform AI",
    );
  }

  if (hasWorkspace && !config.cliQuotaJobId) {
    errors.push(
      "ai-inference: platform AI requires a quota preflight job id (pass DATAPARADE_WORKSPACE_API_KEY and ensure preflight succeeded)",
    );
  }

  return errors;
}

export function resolveAiMode(
  config: ScanConfiguration,
): "byok" | "platform" | "none" {
  if (!config.enableAiInference) return "none";
  if (config.aiApiKey?.trim()) return "byok";
  if (config.workspaceApiKey?.trim()) return "platform";
  return "none";
}
