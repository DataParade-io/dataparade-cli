import {
  summarizeScanErrors,
  truncateFailureMessage,
} from '../../../src/platform-api/cli-scan-failure-report';

describe('cli scan failure report', () => {
  it('keeps a single error as-is', () => {
    expect(summarizeScanErrors(['parser: unexpected token in user.rb'])).toBe(
      'parser: unexpected token in user.rb'
    );
  });

  it('reports the first error and how many others followed', () => {
    expect(
      summarizeScanErrors(['first failure', 'second failure', 'third failure'])
    ).toBe('first failure (+2 more errors)');
  });

  it('uses singular wording for one additional error', () => {
    expect(summarizeScanErrors(['first failure', 'second failure'])).toBe(
      'first failure (+1 more error)'
    );
  });

  it('falls back when the error list is empty or blank', () => {
    expect(summarizeScanErrors([])).toBe('The scanner reported errors.');
    expect(summarizeScanErrors(['   '])).toBe('The scanner reported errors.');
  });

  it('collapses whitespace and truncates long messages', () => {
    expect(truncateFailureMessage('  multi\n  line\tmessage  ')).toBe(
      'multi line message'
    );
    const long = 'x'.repeat(400);
    const truncated = truncateFailureMessage(long);
    expect(truncated).toHaveLength(300);
    expect(truncated.endsWith('…')).toBe(true);
  });
});
