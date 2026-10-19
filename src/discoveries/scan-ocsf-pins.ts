/** Pinned scan-land timestamps for deterministic OCSF records in tests and fixtures. */
export const PINNED_SCAN_ASSERTED_AT = "2026-09-01T00:00:00.000Z";
export const PINNED_SCAN_LAND_DATE = "20260901";

export function landDateFromAssertedAt(assertedAt: string): string {
  const datePart = assertedAt.slice(0, 10).replace(/-/g, "");
  if (datePart.length !== 8) {
    throw new Error(`Invalid asserted_at for land date: ${assertedAt}`);
  }
  return datePart;
}
