import type { ScanConfiguration } from "../core/types";

export function validateAiInferenceCredentials(
  config: ScanConfiguration,
): string[] {
  const errors: string[] = [];
  if (!config.enableAiInference) return errors;

  if (config.hostedInferProxyUrl?.trim()) {
    return errors;
  }

  const hasByok =
    Boolean(config.aiProvider?.trim()) &&
    Boolean(config.aiModel?.trim()) &&
    Boolean(config.aiApiKey?.trim());
  const hasWorkspace = Boolean(config.workspaceApiKey?.trim());
  const hasAnonSession = Boolean(config.anonSessionToken?.trim());

  if (hasByok && (hasWorkspace || hasAnonSession)) {
    errors.push(
      "ai-inference: set either SCAN_BYOK_* (your LLM provider) or platform AI (DATAPARADE_WORKSPACE_API_KEY or anonymous session), not both",
    );
    return errors;
  }

  if (hasWorkspace && hasAnonSession) {
    errors.push(
      "ai-inference: set either DATAPARADE_WORKSPACE_API_KEY or an anonymous AI session, not both",
    );
    return errors;
  }

  if (!hasByok && !hasWorkspace && !hasAnonSession) {
    errors.push(
      "ai-inference: LLM inference requires SCAN_BYOK_PROVIDER, SCAN_BYOK_MODEL, and SCAN_BYOK_API_KEY, DATAPARADE_WORKSPACE_API_KEY for platform AI, or an anonymous platform AI session",
    );
  }

  if ((hasWorkspace || hasAnonSession) && !config.cliQuotaJobId) {
    errors.push(
      "ai-inference: platform AI requires a quota/session job id (preflight or anonymous-session must succeed)",
    );
  }

  return errors;
}

export function resolveAiMode(
  config: ScanConfiguration,
): "byok" | "platform" | "hosted_worker" | "none" {
  if (!config.enableAiInference) return "none";
  if (config.hostedInferProxyUrl?.trim()) return "hosted_worker";
  if (config.aiApiKey?.trim()) return "byok";
  if (config.workspaceApiKey?.trim() || config.anonSessionToken?.trim()) {
    return "platform";
  }
  return "none";
}
