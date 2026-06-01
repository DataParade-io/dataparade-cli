const DEFAULT_TIMEOUT_MS = 120_000;

function parseTimeoutMs(): number {
  const raw = process.env.DATAPARADE_AI_HTTP_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TIMEOUT_MS;
}

/** POST/GET to model APIs with an AbortSignal timeout (default 120s). */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = parseTimeoutMs(),
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
