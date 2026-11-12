import { z } from 'zod';

const status = z.object({
  status: z.enum(['completed', 'disabled', 'not-run', 'unavailable', 'error']),
  findingCount: z.number().int().nonnegative().optional(),
  reason: z.enum(['missing-dependencies', 'timeout', 'model-error']).optional(),
});

export const findingFields = z.object({
  rule: z.string(),
  kind: z.enum(['secret', 'personal', 'crypto', 'deep']),
  finding_id: z.string(),
  line: z.number().int().positive(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  score: z.number().optional(),
});

export const reportFields = z.object({
  schemaVersion: z.literal(1),
  rules: status,
  privacyFilter: status,
});

export type ModelMode = 'auto' | 'off';

export function modelWarning(
  report: z.infer<typeof reportFields>
): string | undefined {
  if (report.privacyFilter.status !== 'unavailable') return;
  const hint =
    report.privacyFilter.reason === 'timeout'
      ? 'The model reached its time limit.'
      : 'Check the local model installation and cache.';
  return `Privacy Filter unavailable. LeftBlock rules completed (${report.rules.findingCount ?? 0} findings). ${hint}`;
}
