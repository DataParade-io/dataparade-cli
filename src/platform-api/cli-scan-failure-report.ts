/** Failure detail reported to the platform so the dashboard can explain what broke. */
export type CliScanFailureReport = {
  code: string;
  message: string;
};

const MAX_FAILURE_MESSAGE_CHARS = 300;

/** Collapses whitespace and caps length so the message stays readable in the activity feed. */
export function truncateFailureMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_FAILURE_MESSAGE_CHARS) return normalized;
  return `${normalized.slice(0, MAX_FAILURE_MESSAGE_CHARS - 1)}…`;
}

/** Reports the first scan error plus how many others followed it. */
export function summarizeScanErrors(errors: string[]): string {
  const cleaned = errors.map((error) => error.trim()).filter(Boolean);
  if (cleaned.length === 0) return 'The scanner reported errors.';
  const remaining = cleaned.length - 1;
  const suffix =
    remaining > 0
      ? ` (+${remaining} more error${remaining > 1 ? 's' : ''})`
      : '';
  return truncateFailureMessage(`${cleaned[0]}${suffix}`);
}
