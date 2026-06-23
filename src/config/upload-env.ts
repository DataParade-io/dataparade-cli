const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function resolveSkipAutoUpload(env: NodeJS.ProcessEnv): boolean {
  const value = env.DATAPARADE_SKIP_AUTO_UPLOAD?.trim().toLowerCase();
  if (!value) return false;
  return TRUTHY.has(value);
}
