/** AWS Lambda ResourceConflictException while the target function is still INIT. */
export const LAMBDA_INITIALIZING_USER_MESSAGE =
  "Platform AI is still starting. Retry the scan in a few seconds.";

export const LAMBDA_INIT_RETRY_DELAYS_MS = [
  1000, 2000, 4000, 8000, 10000,
] as const;

export function isLambdaInitializingError(err: unknown): boolean {
  const parts: string[] = [];
  if (typeof err === "string") {
    parts.push(err);
  }
  if (err instanceof Error) {
    parts.push(err.name, err.message);
  }
  if (err && typeof err === "object") {
    const record = err as Record<string, unknown>;
    for (const key of ["code", "name", "message", "error", "errorMessage"]) {
      if (typeof record[key] === "string") {
        parts.push(record[key]);
      }
    }
  }
  const haystack = parts.join(" ").toLowerCase();
  return (
    haystack.includes("initializing your function") ||
    haystack.includes("ready to invoke shortly") ||
    haystack.includes("resourceconflictexception") ||
    haystack.includes("platform ai is still starting")
  );
}

export function toUserFacingLambdaInitError(err: unknown): Error {
  if (isLambdaInitializingError(err)) {
    return new Error(LAMBDA_INITIALIZING_USER_MESSAGE);
  }
  return err instanceof Error ? err : new Error(String(err));
}
