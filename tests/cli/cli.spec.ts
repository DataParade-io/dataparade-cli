import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

const cliDistPath = path.join(__dirname, '../../dist/bin/cli.js');
const cliCwd = path.join(__dirname, '../../');
const scanFixturePath = path.join(cliCwd, 'tests/fixtures/typescript-basic');

describe('CLI', () => {
  beforeAll(() => {
    if (!existsSync(cliDistPath)) {
      throw new Error(
        `CLI not built. Run 'pnpm build' first. Expected: ${cliDistPath}`
      );
    }
  });

  it('scan <path> writes a dataflow.json wrapper to the current directory and exits 0', () => {
    const result = spawnSync(
      'node',
      [
        cliDistPath,
        'scan',
        scanFixturePath,
        '--no-ai-inference',
        '--skip-auto-upload',
      ],
      {
        encoding: 'utf-8',
        cwd: cliCwd,
      }
    );

    expect(result.status).toBe(0);

    const outputPath = path.join(cliCwd, 'dataflow.json');
    const exists = existsSync(outputPath);

    expect(exists).toBe(true);

    const contents = readFileSync(outputPath, 'utf8').trim();
    const dataflow = JSON.parse(contents);

    expect(dataflow.schemaVersion).toBeDefined();
    expect(dataflow.graph).toBeDefined();
    expect(Array.isArray(dataflow.graph.nodes)).toBe(true);
    expect(Array.isArray(dataflow.graph.edges)).toBe(true);
  });

  it('scan fixture produces a dataflow.json wrapper with at least one node', () => {
    const result = spawnSync(
      'node',
      [
        cliDistPath,
        'scan',
        scanFixturePath,
        '--no-ai-inference',
        '--skip-auto-upload',
      ],
      {
        encoding: 'utf-8',
        cwd: cliCwd,
      }
    );

    expect(result.status).toBe(0);

    const outputPath = path.join(cliCwd, 'dataflow.json');
    const contents = readFileSync(outputPath, 'utf8').trim();
    const dataflow = JSON.parse(contents);

    expect(Array.isArray(dataflow.graph.nodes)).toBe(true);
    expect(dataflow.graph.nodes.length).toBeGreaterThan(0);
  });

  it('scan fixture --output writes a dataflow.json wrapper to the given file and prints a short message', () => {
    const outputFile = 'scan-fixture-summary.json';

    const result = spawnSync(
      'node',
      [
        cliDistPath,
        'scan',
        scanFixturePath,
        '--output',
        outputFile,
        '--no-ai-inference',
        '--skip-auto-upload',
      ],
      {
        encoding: 'utf-8',
        cwd: cliCwd,
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `[scan] dataflow.json written to ${path.join(cliCwd, outputFile)}`
    );

    const fileContents = readFileSync(
      path.join(cliCwd, outputFile),
      'utf8'
    ).trim();
    const dataflow = JSON.parse(fileContents);

    expect(dataflow.graph).toBeDefined();
    expect(Array.isArray(dataflow.graph.nodes)).toBe(true);
  });

  it('scan mixed-language fixture prints teaching lines before dataflow.json written', () => {
    const teachingFixture = path.join(
      cliCwd,
      'tests/fixtures/mixed-language-basic'
    );
    const outputFile = 'scan-teaching-progress.json';

    const result = spawnSync(
      'node',
      [
        cliDistPath,
        'scan',
        teachingFixture,
        '--output',
        outputFile,
        '--no-ai-inference',
        '--skip-auto-upload',
      ],
      {
        encoding: 'utf-8',
        cwd: cliCwd,
        env: {
          ...process.env,
          // Force plain progress (no spinner/ANSI) for stable assertions.
          NO_COLOR: '1',
        },
      }
    );

    expect(result.status).toBe(0);

    const writtenMarker = `[scan] dataflow.json written to ${path.join(cliCwd, outputFile)}`;
    expect(result.stdout).toContain(writtenMarker);

    const beforeWrite = result.stdout.split(writtenMarker)[0] ?? '';
    expect(beforeWrite).toMatch(/Map privacy data flows from your code/);
    const teachingHits = [
      /Found \d+ .+ routes?/i,
      /Talks to /i,
      /Calls out to /i,
      /Stripe|OpenAI|Sentry|Postgres|Express|FastAPI/i,
    ].filter((re) => re.test(beforeWrite));
    expect(teachingHits.length).toBeGreaterThanOrEqual(2);

    // Non-TTY / NO_COLOR: no ANSI escape codes and no braille spinner frames.
    // eslint-disable-next-line no-control-regex -- asserting absence of ESC CSI sequences
    expect(result.stdout).not.toMatch(/\x1b\[[0-9;]*m/);
    expect(result.stdout).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
  });

  it('unknown command shows usage and exits non-zero', () => {
    const result = spawnSync('node', [cliDistPath, 'unknowncommand'], {
      encoding: 'utf-8',
      cwd: cliCwd,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Unknown command|error|usage|Usage/i);
  });

  it('--help shows usage', () => {
    const result = spawnSync('node', [cliDistPath, '--help'], {
      encoding: 'utf-8',
      cwd: cliCwd,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('dataparade');
    expect(result.stdout).toContain('scan');
  });

  it('scan --help shows scan usage', () => {
    const result = spawnSync('node', [cliDistPath, 'scan', '--help'], {
      encoding: 'utf-8',
      cwd: cliCwd,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/scan|path/i);
  });
});
