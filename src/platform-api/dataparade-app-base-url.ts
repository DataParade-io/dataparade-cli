/**
 * Default DataParade web app (frontend Lambda URL). Used when the CLI prints
 * dashboard preview links. Override with DATAPARADE_APP_URL for local dev.
 */
export const DEFAULT_DATAPARADE_APP_URL = "https://app.dataparade.io";

/** Resolve web app origin (no trailing slash). */
export function getDataparadeAppBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base = env.DATAPARADE_APP_URL?.trim() || DEFAULT_DATAPARADE_APP_URL;
  return base.replace(/\/$/, "");
}
