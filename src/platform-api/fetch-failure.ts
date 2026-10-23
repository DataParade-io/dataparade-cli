const TRANSIENT_CAUSE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

type ErrorCause = {
  code?: string;
  message?: string;
};

function readCause(err: unknown): ErrorCause | undefined {
  if (!(err instanceof Error)) return undefined;
  const cause = (err as Error & { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') {
    return undefined;
  }
  const record = cause as ErrorCause;
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
  };
}

/** Socket-level fetch failures (no HTTP response), including Node's "fetch failed". */
export function isTransientFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  if (message === 'fetch failed' || message.includes('network')) return true;
  const code = readCause(err)?.code;
  return Boolean(code && TRANSIENT_CAUSE_CODES.has(code));
}

/** Code plus cause text, without repeating the generic "fetch failed" wrapper. */
export function fetchFailureDetail(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = readCause(err);
  const parts = [cause?.code, cause?.message].filter((part): part is string =>
    Boolean(part && part !== err.message)
  );
  if (parts.length === 0) return err.message;
  return parts.join(': ');
}

export function describeRequestTarget(url: string, method: string): string {
  const verb = method.toUpperCase();
  try {
    const parsed = new URL(url);
    return `${verb} ${parsed.origin}${parsed.pathname}`;
  } catch {
    return `${verb} ${url}`;
  }
}

export function toApiReachabilityError(
  err: unknown,
  url: string,
  method: string,
  attempts: number
): Error {
  const where = describeRequestTarget(url, method);
  const detail = fetchFailureDetail(err);
  const tries = attempts > 1 ? ` Tried ${attempts} times.` : '';
  return new Error(
    `Could not reach the DataParade API (${where}): ${detail}.${tries} Run the scan again.`
  );
}

/**
 * Scan-command message. Unwraps a bare "fetch failed" when a caller did not
 * already attach the request target.
 */
export function describeThrownError(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown error during scan.';
  if (err.message !== 'fetch failed') return err.message;
  const detail = fetchFailureDetail(err);
  if (detail === err.message) {
    return 'Could not reach the DataParade API: fetch failed. Run the scan again.';
  }
  return `Could not reach the DataParade API: ${detail}. Run the scan again.`;
}

/**
 * Short reason for an optional platform step (AI session, upload) that failed,
 * for a one-line "… unavailable (<reason>)" message.
 */
export function describeUnavailableReason(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown error';
  if (isTransientFetchError(err)) {
    return `could not reach the DataParade API: ${fetchFailureDetail(err)}`;
  }
  return err.message.trim().replace(/\.$/, '') || 'unknown error';
}
