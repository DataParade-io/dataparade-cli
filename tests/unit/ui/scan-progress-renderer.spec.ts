jest.mock('@clack/prompts', () => {
  const spin = {
    start: jest.fn(),
    stop: jest.fn(),
    message: jest.fn(),
  };
  return {
    intro: jest.fn(),
    outro: jest.fn(),
    note: jest.fn(),
    spinner: jest.fn(() => spin),
    log: {
      message: jest.fn(),
      success: jest.fn(),
      step: jest.fn(),
      warn: jest.fn(),
    },
  };
});

import {
  createScanProgressRenderer,
  formatPreviewLink,
  hasAnsi,
  stripAnsi,
} from '../../../src/ui/scan-progress-renderer';
import type { DetectedComponent, RawFinding } from '../../../src/core/types';
import * as prompts from '@clack/prompts';

function captureLines(): {
  lines: string[];
  writeLine: (line: string) => void;
} {
  const lines: string[] = [];
  return {
    lines,
    writeLine: (line: string) => {
      lines.push(line);
    },
  };
}

describe('ScanProgressRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('non-TTY output has no spinner frames and no ANSI', async () => {
    const { lines, writeLine } = captureLines();
    const ui = await createScanProgressRenderer({
      isTTY: false,
      noColor: false,
      writeLine,
      projectLabel: '/tmp/demo',
    });

    ui.start();
    ui.onProgress({
      phase: 'ingest',
      filesProcessed: 0,
      totalFiles: 0,
      progress: 0.05,
      message: 'Ingesting...',
    });
    ui.onProgress({
      phase: 'analyze',
      filesProcessed: 1,
      totalFiles: 1,
      progress: 0.25,
      message: 'Analyzing...',
    });
    ui.onRecognition({
      findings: [
        {
          pattern: 'express_route',
          name: 'route',
          confidence: 0.9,
          location: { filePath: 'a.ts', startLine: 1, endLine: 1 },
          properties: { framework: 'express' },
        } satisfies RawFinding,
      ],
      components: [
        {
          id: 'tp-1',
          name: 'stripe',
          type: 'third_party',
          confidence: 0.9,
          detectedFrom: [],
          properties: { serviceName: 'stripe' },
          sourceLocations: [],
        } satisfies DetectedComponent,
      ],
    });
    ui.onWroteDataflow('/tmp/out.json');
    ui.onPreviewUrl('https://example.test/preview');
    ui.finish();

    const joined = lines.join('\n');
    expect(hasAnsi(joined)).toBe(false);
    expect(joined).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    expect(joined).toContain('Map privacy data flows from your code');
    expect(joined).toContain('Found 1 Express route');
    expect(joined).toContain('Calls out to Stripe');
    expect(joined).toContain("Here's what stood out");
    expect(joined).toContain('Saved your data-flow map');
    expect(joined).toContain('What to do next');
    expect(joined).toContain('Open your diagram:');
    expect(joined).toContain('https://example.test/preview');
    expect(joined).not.toContain('Your preview is ready whenever you are');
    expect(ui.usesClackChrome).toBe(false);
  });

  it('formats the preview link with ANSI when color is on', () => {
    const plain = formatPreviewLink('https://example.test/preview', false);
    expect(plain).toBe('https://example.test/preview');
    expect(hasAnsi(plain)).toBe(false);

    const colored = formatPreviewLink('https://example.test/preview', true);
    expect(colored).toContain('https://example.test/preview');
    expect(hasAnsi(colored)).toBe(true);
    // No underline (SGR 4): it reads as broken next to the terminal's own link styling.
    expect(colored).not.toMatch(/\[[0-9;]*\b4\b[0-9;]*m/);
  });

  it('TTY finish prints What to do next without a wrapping box', async () => {
    const { writeLine } = captureLines();
    const ui = await createScanProgressRenderer({
      isTTY: true,
      noColor: false,
      writeLine,
      prompts,
    });
    const longUrl =
      'http://localhost:3001/dashboard?importDraft=8ff8d852-b39a-4973-947b-dd1425bb4f99&cliSession=2ca5b9c6-c173-4a7a-bcbf-242f0479ecf7';
    ui.onPreviewUrl(longUrl);
    ui.finish();

    expect(prompts.note).not.toHaveBeenCalled();
    expect(prompts.log.step).toHaveBeenCalledWith('What to do next');
    const body = String(
      (prompts.log.message as jest.Mock).mock.calls.at(-1)?.[0]
    );
    expect(body).toContain('Open your diagram:');
    expect(hasAnsi(body)).toBe(true);
    const urlLine = stripAnsi(body)
      .split('\n')
      .find((line) => line.includes('http'));
    expect(urlLine).toBe(longUrl);
  });

  it('TTY shows AI inference as its own step with one result line', async () => {
    const { lines, writeLine } = captureLines();
    const ui = await createScanProgressRenderer({
      isTTY: true,
      noColor: false,
      writeLine,
      prompts,
    });
    const spin = (prompts.spinner as jest.Mock)();
    (prompts.spinner as jest.Mock).mockClear();

    ui.onProgress({
      phase: 'ai_enrichment',
      filesProcessed: 1,
      totalFiles: 1,
      progress: 0.85,
      message: 'Running LLM inference...',
    });
    expect(prompts.spinner).toHaveBeenCalledTimes(1);
    expect(spin.start).toHaveBeenLastCalledWith('Filling in details with AI');

    ui.onAiResult({ proposalsApplied: 5 });
    expect(spin.stop).toHaveBeenLastCalledWith('Filling in details with AI');
    expect(prompts.log.message).toHaveBeenLastCalledWith(
      'Filled in 5 details from your code'
    );
    expect(lines.some((line) => line.includes('[dataparade-ai]'))).toBe(false);
  });

  it('non-TTY shows the AI step and its result as plain lines', async () => {
    const { lines, writeLine } = captureLines();
    const ui = await createScanProgressRenderer({
      isTTY: false,
      noColor: false,
      writeLine,
    });
    ui.onProgress({
      phase: 'ai_enrichment',
      filesProcessed: 1,
      totalFiles: 1,
      progress: 0.85,
    });
    ui.onAiResult({ proposalsApplied: 0 });

    expect(lines).toContain('… Filling in details with AI');
    expect(lines).toContain('✓ Filling in details with AI');
    expect(lines).toContain('  · Nothing new to add from AI');
  });

  it('ignores an AI result when the AI step never started', async () => {
    const { lines, writeLine } = captureLines();
    const ui = await createScanProgressRenderer({
      isTTY: false,
      noColor: false,
      writeLine,
    });
    ui.onAiResult({ proposalsApplied: 3 });
    expect(lines.some((line) => line.includes('AI'))).toBe(false);
  });

  it('NO_COLOR disables Clack chrome and strips ANSI from plain writes', async () => {
    const { lines, writeLine } = captureLines();
    const ui = await createScanProgressRenderer({
      isTTY: true,
      noColor: true,
      writeLine,
    });

    ui.start();
    ui.onProgress({
      phase: 'ingest',
      filesProcessed: 0,
      totalFiles: 0,
      progress: 0.05,
    });
    ui.onWroteDataflow();

    expect(ui.usesClackChrome).toBe(false);
    const joined = lines.join('\n');
    expect(hasAnsi(joined)).toBe(false);
    expect(stripAnsi(joined)).toBe(joined);
    expect(joined).toContain('Map privacy data flows from your code');
    expect(joined).toContain('Saved your data-flow map');
  });

  it('TTY keeps technical lines inside Clack instead of raw [scan] logs', async () => {
    const { lines, writeLine } = captureLines();
    const ui = await createScanProgressRenderer({
      isTTY: true,
      noColor: false,
      writeLine,
      prompts,
    });
    ui.onWroteDataflow(`${process.cwd()}/outputs/out.json`);
    ui.warn('ai-provider: request failed');
    ui.showTechnicalDetails('Scan details', [
      '[scan] ai-usage: provider_calls=1 tokens_total=10',
    ]);
    ui.onPreviewUrl('https://example.test/preview', 'Claim uses 1 scan slot.');
    ui.finish();

    const success = String(
      (prompts.log.success as jest.Mock).mock.calls.at(-1)?.[0]
    );
    expect(stripAnsi(success)).toContain('./outputs/out.json');
    expect(prompts.log.warn).toHaveBeenCalledWith(
      'ai-provider: request failed'
    );
    const notes = (prompts.note as jest.Mock).mock.calls;
    const details = notes.find((call) => call[1] === 'Scan details');
    expect(stripAnsi(String(details?.[0]))).toBe(
      'ai-usage: provider_calls=1 tokens_total=10'
    );
    expect(
      String((prompts.log.message as jest.Mock).mock.calls.at(-1)?.[0])
    ).toContain('Claim uses 1 scan slot.');
    expect(lines.some((line) => line.includes('[scan]'))).toBe(false);
  });

  it('non-TTY prints technical lines verbatim for scripts', async () => {
    const { lines, writeLine } = captureLines();
    const ui = await createScanProgressRenderer({
      isTTY: false,
      noColor: false,
      writeLine,
    });
    ui.showTechnicalDetails('Scan details', [
      '[scan] ai-usage: provider_calls=1 tokens_total=10',
    ]);
    expect(lines).toEqual([
      '[scan] ai-usage: provider_calls=1 tokens_total=10',
    ]);
  });
});
