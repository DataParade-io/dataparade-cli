/**
 * Default DataParade platform API (AWS API Gateway). Used when the CLI talks to
 * workspace quota / platform LLM proxy. Override with DATAPARADE_API_BASE_URL for
 * local monorepo dev (e.g. http://localhost:3000).
 */
export const DEFAULT_DATAPARADE_API_BASE_URL =
  "https://hrfp8zmxh8.execute-api.us-east-1.amazonaws.com";

/** Resolve platform API origin (no trailing slash). */
export function getDataparadeApiBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base =
    env.DATAPARADE_API_BASE_URL?.trim() ||
    env.DATAPARADE_API_URL?.trim() ||
    DEFAULT_DATAPARADE_API_BASE_URL;
  return base.replace(/\/$/, "");
}
