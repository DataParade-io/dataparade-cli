import { Command, Option } from 'commander';
import { z } from 'zod';
import { runLocalScanner } from './process';
import {
  findingFields,
  modelWarning,
  reportFields,
  type ModelMode,
} from './report';

const auditReport = reportFields.extend({
  sources: z.array(
    z.object({
      source: z.string(),
      status: z.enum(['completed', 'missing', 'partial', 'error']),
      sessionsScanned: z.number().int().nonnegative(),
      sessionsWithoutProject: z.number().int().nonnegative(),
      readErrors: z.number().int().nonnegative(),
    })
  ),
  findings: z.array(
    findingFields.extend({
      agent: z.string(),
      sessionId: z.string(),
      message: z.number().int().positive(),
      part: z.number().int().positive(),
      source: z
        .object({
          file: z.string(),
          line: z.number().int().positive().nullable(),
          row: z.number().int().nonnegative().nullable(),
        })
        .nullable(),
      score: z.number().nullish(),
    })
  ),
});

type AuditOptions = {
  all?: boolean;
  source?: string[];
  session?: string;
  since?: string;
  format: 'text' | 'json';
  privacyFilter: ModelMode;
  failOnFindings?: boolean;
};

// Escape control characters before displaying paths or IDs from local histories.
function printable(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

export function registerSessionScan(program: Command): void {
  const sessions = program
    .command('sessions')
    .description('Inspect local coding sessions');
  sessions
    .command('scan [path]')
    .description(
      'Scan the last seven days of coding sessions for this project with LeftBlock'
    )
    .option('--all', 'Include sessions across all projects')
    .option(
      '--source <source>',
      'Select a BotSpy source (repeatable)',
      (source: string, sources: string[]) => [...sources, source],
      []
    )
    .option(
      '--session <id>',
      'Scan one exact session ID across projects and dates'
    )
    .option(
      '--since <time>',
      'Select sessions active since a date, timestamp, or duration (default: 7d)'
    )
    .addOption(
      new Option('--format <format>', 'Report format')
        .choices(['text', 'json'])
        .default('text')
    )
    .addOption(
      new Option(
        '--privacy-filter <mode>',
        'Use the local Privacy Filter when available'
      )
        .choices(['auto', 'off'])
        .default('auto')
    )
    .option(
      '--fail-on-findings',
      'Exit 1 if a completed audit reports findings'
    )
    .action(async (project: string | undefined, options: AuditOptions) => {
      if (
        (project && (options.all || options.session)) ||
        (options.session && (options.all || options.since))
      ) {
        console.error(
          '[sessions scan] Use a project path, --all, or --session. --since does not apply to --session.'
        );
        process.exitCode = 2;
        return;
      }
      const args = ['privacy-audit', '--privacy-filter', options.privacyFilter];
      if (project !== undefined) args.push(`--project=${project}`);
      if (options.all) args.push('--all');
      if (options.session !== undefined)
        args.push(`--session=${options.session}`);
      if (options.since !== undefined) args.push(`--since=${options.since}`);
      for (const source of options.source ?? [])
        args.push(`--source=${source}`);
      if (process.env.DATAPARADE_LEFTBLOCK)
        args.push(`--leftblock=${process.env.DATAPARADE_LEFTBLOCK}`);
      try {
        const { code, output } = await runLocalScanner(
          process.env.DATAPARADE_BOTSPY || 'botspy',
          args
        );
        if (code === 1) {
          console.error('[sessions scan] The selected session was not found.');
          process.exitCode = 2;
          return;
        }
        if (code === 2) {
          console.error(
            '[sessions scan] Check the project path, source names, and date options. Use a BotSpy version with privacy-audit.'
          );
          process.exitCode = 2;
          return;
        }
        if (code !== 0 && code !== 3) throw new Error('BotSpy process failed');
        const report = auditReport.parse(JSON.parse(output));
        if (options.format === 'json') {
          console.log(JSON.stringify(report, null, 2));
        } else {
          for (const source of report.sources) {
            console.log(
              `${printable(source.source)}: ${source.status}; ${source.sessionsScanned} sessions scanned, ${source.sessionsWithoutProject} without a project match, ${source.readErrors} read errors`
            );
          }
          for (const finding of report.findings) {
            const source = finding.source;
            const location = source
              ? ` ${printable(source.file)}${source.line ? `:${source.line}` : source.row != null ? ` row ${source.row}` : ''}`
              : '';
            console.log(
              `${printable(finding.agent)} ${printable(finding.sessionId)} message ${finding.message} part ${finding.part}:${location} ${printable(finding.rule)} [id ${printable(finding.finding_id)}]`
            );
          }
          console.log(
            `${report.findings.length} sensitive information finding(s).`
          );
        }
        const warning = modelWarning(report);
        if (warning) console.warn(`[sessions scan] ${warning}`);
        if (code === 3 || report.rules.status !== 'completed') {
          console.error(
            '[sessions scan] Audit incomplete. Check the source statuses and local scanner setup.'
          );
          process.exitCode = 2;
        } else if (options.failOnFindings && report.findings.length > 0) {
          process.exitCode = 1;
        }
      } catch {
        console.error(
          '[sessions scan] Could not run the local audit. Check that compatible BotSpy, LeftBlock, and Gitleaks are installed.'
        );
        process.exitCode = 2;
      }
    });
}
