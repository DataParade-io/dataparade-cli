import type { Command } from 'commander';

import { KbError, resolveKbPaths } from '../kb/kb-store';
import { DEFAULT_OUTPUT_DIRNAME } from '../facts/layout';
import { exportOcsf } from './export-ocsf';

export function registerExportCommands(program: Command): void {
  const exportCommand = program
    .command('export')
    .description('Export the knowledge base to other formats');

  exportCommand
    .command('ocsf')
    .description(
      'Write OCSF Architecture Discovery records from the knowledge base (facts with answers applied)'
    )
    .option(
      '--kb <dir>',
      'Knowledge base directory (where scan wrote dataflow.json)',
      DEFAULT_OUTPUT_DIRNAME
    )
    .requiredOption(
      '--out <dir>',
      'Folder for the OCSF records; an earlier export there is replaced'
    )
    .action((options: { kb: string; out: string }) => {
      try {
        const result = exportOcsf(resolveKbPaths(options.kb), options.out);
        console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      } catch (error) {
        console.log(
          JSON.stringify(
            {
              ok: false,
              code: error instanceof KbError ? error.code : 'ERROR',
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2
          )
        );
        process.exitCode = 1;
      }
    });
}
