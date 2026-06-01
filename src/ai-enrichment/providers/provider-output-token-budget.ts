/**
 * Completion (output) token budget for providers that return large JSON blobs
 * (e.g. many propertyEvidence rows). Too low a ceiling yields truncated JSON.
 */
export function clampStructuredJsonCompletionTokens(
  requested: number | undefined,
): number {
  const r = requested ?? 8192;
  return Math.min(16_384, Math.max(4096, Math.floor(r)));
}
