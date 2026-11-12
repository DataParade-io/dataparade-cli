import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { z } from 'zod';
import {
  gitignorePatternToRegex,
  gitignoreRulesForDir,
  isPathIgnored,
  shouldSkipDirectoryName,
  toPosixPath,
  type IgnoreRule,
} from '@dataparade/scanner';
import { runLocalScanner } from './process';
import {
  findingFields,
  modelWarning,
  reportFields,
  type ModelMode,
} from './report';

const generated =
  /(?:\.min\.(?:js|mjs|css)|\.map|\.snap|\.lockb?|\.generated\.[^.]+|_pb2(?:_grpc)?\.py|\.pb\.go)$/i;
const skippedDirs = new Set([
  'vendored',
  'third_party',
  'sand-client-persistence',
  '__pycache__',
]);
const skippedFiles = new Set([
  '.git',
  'package-lock.json',
  'pnpm-lock.yaml',
  'go.sum',
  'npm-shrinkwrap.json',
]);
const maxFileBytes = 1024 * 1024;
const maxTotalBytes = 64 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const fileFinding = findingFields.extend({ id: z.string() });
const fileReport = reportFields.extend({ findings: fileFinding.array() });

export const SENSITIVE_FINDINGS_BASENAME = 'sensitive-findings.json';

type ProjectScan = {
  root: string;
  target: string;
  excludes: string[];
  modelMode: ModelMode;
  enabled: boolean;
};

async function* projectRecords(
  options: ProjectScan,
  coverage: {
    filesScanned: number;
    filesOverSizeLimit: number;
    byteLimitReached: boolean;
  },
  selected: Set<string>
): AsyncGenerator<string> {
  const patterns = options.excludes.map((p) =>
    toPosixPath(p.trim().replace(/^\.\/+/, ''))
  );
  const globs = patterns.map((p) => ({
    directory: gitignorePatternToRegex(
      p.endsWith('/**') ? p.slice(0, -3) : p,
      true
    ),
    file: gitignorePatternToRegex(p, false),
  }));
  let total = 0;
  async function* walk(
    entryPath: string,
    inherited: IgnoreRule[]
  ): AsyncGenerator<string> {
    if (coverage.byteLimitReached) return;
    const id = toPosixPath(path.relative(options.root, entryPath));
    const stat = await fs.lstat(entryPath);
    if (
      id &&
      globs.some((g) => (stat.isDirectory() ? g.directory : g.file).test(id))
    )
      return;
    if (id && isPathIgnored(entryPath, stat.isDirectory(), inherited)) return;
    if (stat.isDirectory()) {
      const name = path.basename(entryPath);
      if (id && (shouldSkipDirectoryName(name) || skippedDirs.has(name)))
        return;
      const rules = await gitignoreRulesForDir(entryPath, inherited);
      const children = await fs.readdir(entryPath);
      for (const name of children.sort())
        yield* walk(path.join(entryPath, name), rules);
      return;
    }
    if (
      !stat.isFile() ||
      generated.test(id) ||
      skippedFiles.has(path.basename(id))
    )
      return;
    if (/^project\/(?:issues|events|\.cache)\//.test(id)) return;
    if (stat.size > maxFileBytes) {
      coverage.filesOverSizeLimit++;
      return;
    }
    const contents = await fs.readFile(entryPath);
    if (contents.includes(0)) return;
    let text: string;
    try {
      text = decoder.decode(contents);
    } catch {
      return;
    }
    if (contents.length > maxFileBytes) {
      coverage.filesOverSizeLimit++;
      return;
    }
    if (total + contents.length > maxTotalBytes) {
      coverage.byteLimitReached = true;
      return;
    }
    total += contents.length;
    selected.add(id);
    coverage.filesScanned++;
    yield JSON.stringify({ id, text }) + '\n';
  }
  const rules =
    options.target === options.root
      ? []
      : await gitignoreRulesForDir(options.root, []);
  yield* walk(options.target, rules);
}

/** A separate local artifact. Nothing here is passed to the structural scanner. */
export async function writeProjectSensitiveScan(
  dataflowOutputPath: string,
  options: ProjectScan,
  warn: (message: string) => void
): Promise<number | undefined> {
  const coverage = {
    filesScanned: 0,
    filesOverSizeLimit: 0,
    byteLimitReached: false,
  };
  const selected = new Set<string>();
  const unavailable = {
    schemaVersion: 1,
    rules: { status: options.enabled ? 'error' : 'disabled' },
    privacyFilter: { status: options.enabled ? 'not-run' : 'disabled' },
    findings: [],
    coverage,
  };
  let report: object = unavailable;
  let findingCount: number | undefined;
  if (options.enabled) {
    try {
      const { code, output } = await runLocalScanner(
        process.env.DATAPARADE_LEFTBLOCK || 'leftblock',
        [
          'scan',
          '--jsonl',
          '--format',
          'report',
          '--privacy-filter',
          options.modelMode,
        ],
        projectRecords(options, coverage, selected)
      );
      const parsed = fileReport.parse(JSON.parse(output));
      if (
        (code !== 0 && code !== 1) ||
        parsed.rules.status !== 'completed' ||
        parsed.findings.some((f) => !selected.has(f.id))
      ) {
        throw new Error('Incomplete sensitive scan');
      }
      const warning = modelWarning(parsed);
      if (warning) warn(warning);
      if (coverage.byteLimitReached || coverage.filesOverSizeLimit > 0) {
        warn(
          'LeftBlock skipped some files because they exceeded the scan size limits.'
        );
      }
      report = {
        ...parsed,
        findings: parsed.findings.map(({ id, ...finding }) => ({
          ...finding,
          file: id,
        })),
        coverage,
      };
      findingCount = parsed.findings.length;
    } catch {
      warn(
        'LeftBlock could not complete the sensitive scan. Check that compatible LeftBlock and Gitleaks are installed.'
      );
    }
  }
  if (
    path.basename(dataflowOutputPath).toLowerCase() ===
    SENSITIVE_FINDINGS_BASENAME
  ) {
    if (options.enabled)
      warn(
        'Choose a different --output name to save the local sensitive findings report.'
      );
    return findingCount;
  }
  try {
    const outputDir = path.dirname(dataflowOutputPath);
    const tempDir = await fs.mkdtemp(path.join(outputDir, '.sensitive-'));
    try {
      const tempFile = path.join(tempDir, SENSITIVE_FINDINGS_BASENAME);
      await fs.writeFile(tempFile, JSON.stringify(report, null, 2) + '\n', {
        mode: 0o600,
      });
      await fs.rename(
        tempFile,
        path.join(outputDir, SENSITIVE_FINDINGS_BASENAME)
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  } catch {
    warn('Could not write the local sensitive findings report.');
  }
  return findingCount;
}
