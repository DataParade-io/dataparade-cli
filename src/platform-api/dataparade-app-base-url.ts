/**
 * Default DataParade web app. Used when the CLI prints dashboard preview links and
 * neither DATAPARADE_APP_URL nor the API's upload response names the app.
 */
export const DEFAULT_DATAPARADE_APP_URL = "https://app.dataparade.io";

/**
 * Resolve web app origin (no trailing slash): DATAPARADE_APP_URL, else the app the API
 * named in its upload response (so an upload to the dev API links to the dev app), else
 * the default.
 */
export function getDataparadeAppBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  fromApi?: string,
): string {
  const api = fromApi?.trim();
  const base = env.DATAPARADE_APP_URL?.trim() || (api && /^https?:\/\//.test(api) ? api : "") || DEFAULT_DATAPARADE_APP_URL;
  return base.replace(/\/$/, "");
}
