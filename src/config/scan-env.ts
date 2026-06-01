export function resolveWorkspaceApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.DATAPARADE_WORKSPACE_API_KEY?.trim();
  return value || undefined;
}

export function resolveByokApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.SCAN_BYOK_API_KEY?.trim();
  return value || undefined;
}

export function resolveByokProvider(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.SCAN_BYOK_PROVIDER?.trim();
  return value || undefined;
}

export function resolveByokModel(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.SCAN_BYOK_MODEL?.trim();
  return value || undefined;
}

export function resolveScanAiInference(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.SCAN_AI_INFERENCE?.trim();
  return value || undefined;
}

function parseTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true";
}

/** Extra provider HTTP / normalization logging (all providers, not OpenAI-only). */
export function isScanAiDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseTruthyEnvFlag(env.SCAN_AI_DEBUG);
}
