import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runLocalScanner } from '../../../src/sensitive-scan/process';
import { writeProjectSensitiveScan } from '../../../src/sensitive-scan/project';
import { scanOutputExcludes } from '../../../src/output/scan-output-excludes';

jest.mock('../../../src/sensitive-scan/process');

it('preserves a data-flow output named sensitive-findings.json', async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'dataparade-sensitive-scan-')
  );
  try {
    const output = path.join(root, 'sensitive-findings.json');
    await fs.writeFile(output, 'existing data-flow artifact');
    await writeProjectSensitiveScan(
      output,
      {
        root,
        target: root,
        excludes: [],
        modelMode: 'off',
        enabled: false,
      },
      jest.fn()
    );
    expect(await fs.readFile(output, 'utf8')).toBe(
      'existing data-flow artifact'
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('keeps rule locations when the model is unavailable and scopes the input files', async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'dataparade-sensitive-scan-')
  );
  try {
    const output = path.join(root, '.dataparade');
    await fs.mkdir(output);
    await fs.writeFile(path.join(output, 'sensitive-findings.json'), '{}');
    await fs.writeFile(path.join(root, 'notes.txt'), 'synthetic test value');
    await fs.writeFile(path.join(root, 'exclude.txt'), 'excluded');
    await fs.writeFile(path.join(root, 'ignored.txt'), 'ignored');
    await fs.writeFile(path.join(root, '.gitignore'), 'ignored.txt\n');
    if (process.platform !== 'win32') {
      await fs.symlink(
        path.join(root, 'exclude.txt'),
        path.join(root, 'link.txt')
      );
    }
    const ids: string[] = [];
    jest
      .mocked(runLocalScanner)
      .mockImplementationOnce(async (_executable, _args, input) => {
        for await (const record of input!) ids.push(JSON.parse(record).id);
        return {
          code: 1,
          output: JSON.stringify({
            schemaVersion: 1,
            rules: { status: 'completed', findingCount: 1 },
            privacyFilter: {
              status: 'unavailable',
              reason: 'missing-dependencies',
            },
            findings: [
              {
                id: 'notes.txt',
                line: 1,
                start: 0,
                end: 20,
                rule: 'example-rule',
                kind: 'secret',
                finding_id: 'synthetic',
                value: 'synthetic test value',
              },
            ],
          }),
        };
      });
    const warn = jest.fn();
    await writeProjectSensitiveScan(
      path.join(output, 'dataflow.json'),
      {
        root,
        target: root,
        enabled: true,
        modelMode: 'auto',
        excludes: [
          ...scanOutputExcludes(root, path.join(output, 'dataflow.json')),
          'exclude.txt',
        ],
      },
      warn
    );
    expect(ids).toEqual(['.gitignore', 'notes.txt']);
    const outputText = await fs.readFile(
      path.join(output, 'sensitive-findings.json'),
      'utf8'
    );
    expect(outputText).not.toContain('synthetic test value');
    const report = JSON.parse(outputText);
    expect(report.findings).toEqual([
      expect.objectContaining({ file: 'notes.txt', line: 1 }),
    ]);
    expect(report.privacyFilter.status).toBe('unavailable');
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
