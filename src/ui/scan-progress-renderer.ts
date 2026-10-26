import path from 'node:path';
import { styleText } from 'node:util';
import type { ScanProgress } from '../core/types';
import { renderBrandHeader } from './brand';
import {
  buildTeachingLineGroups,
  flattenTeachingLines,
} from './teaching-lines';
import type {
  ScanAiStepResult,
  ScanProgressRendererOptions,
  ScanRecognitionPayload,
  ScanUiStepId,
} from './types';

// @clack/prompts is ESM-only. This package compiles to CommonJS, and tsc rewrites
// import() to require(), which crashes on Node 20. A real dynamic import has to
// be hidden from the compiler. Load it only for TTY chrome.
type ClackPrompts = typeof import('@clack/prompts');

async function loadClack(): Promise<ClackPrompts> {
  const importEsm = new Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<ClackPrompts & { default?: ClackPrompts }>;
  const mod = await importEsm('@clack/prompts');
  if (typeof mod.intro === 'function') return mod;
  if (mod.default && typeof mod.default.intro === 'function')
    return mod.default;
  return mod;
}

// ESC [ … m — built without a literal control char so eslint no-control-regex is happy.
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

type SpinnerHandle = {
  start: (msg?: string) => void;
  stop: (msg?: string) => void;
  cancel?: (msg?: string) => void;
  error?: (msg?: string) => void;
  message: (msg?: string) => void;
};

const STEP_LABELS: Record<ScanUiStepId, string> = {
  scanning_files: 'Reading your project files',
  analyzing: 'Getting a feel for the codebase',
  detecting_frameworks: 'Looking for APIs and routes',
  mapping_data_stores: 'Looking for databases',
  finding_outbound: 'Checking who you call outside',
  ai_enrichment: 'Filling in details with AI',
};

function envNoColor(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.NO_COLOR;
  return typeof value === 'string' && value.length > 0;
}

type PaintStyle =
  | 'cyan'
  | 'dim'
  | 'green'
  | 'underline'
  | readonly ('cyan' | 'underline' | 'bold')[];

function paint(enabled: boolean, style: PaintStyle, text: string): string {
  if (!enabled) return text;
  return styleText(style as Parameters<typeof styleText>[0], text);
}

/**
 * Make the preview URL stand out in the next-step block.
 * Uses explicit CSI sequences so our colorEnabled flag wins even when
 * process.env.NO_COLOR would make util.styleText a no-op.
 */
export function formatPreviewLink(url: string, colorEnabled: boolean): string {
  if (!colorEnabled) {
    return url;
  }
  const esc = String.fromCharCode(27);
  // Color only: terminals already underline links on hover.
  return `${esc}[36m${url}${esc}[39m`;
}

export function formatAiStepResult(result: ScanAiStepResult): string {
  const applied = result.proposalsApplied;
  if (applied <= 0) return 'Nothing new to add from AI';
  return applied === 1
    ? 'Filled in 1 detail from your code'
    : `Filled in ${applied} details from your code`;
}

/** Output path relative to cwd when it lives below it, otherwise the ~ form. */
export function formatOutputPath(outputPath: string): string {
  const relative = path.relative(process.cwd(), outputPath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return `./${relative}`;
  }
  return formatProjectLabel(outputPath);
}

/** Prefer a short, human path in the header (home → ~). */
export function formatProjectLabel(projectPath: string): string {
  const home = process.env.HOME?.trim();
  if (home && projectPath.startsWith(`${home}/`)) {
    return `~${projectPath.slice(home.length)}`;
  }
  return projectPath;
}

export type ScanUploadFailure = {
  /** Why the upload failed, without a trailing period. */
  reason: string;
  /** Exact command to retry the upload. */
  retryCommand: string;
  /** Optional extra advice, e.g. how to avoid the anonymous per-IP cap. */
  hint?: string;
};

/**
 * Staged scan progress for TTY (Clack) and plain logs for non-TTY / NO_COLOR.
 */
export class ScanProgressRenderer {
  private readonly isTTY: boolean;
  private readonly noColor: boolean;
  private readonly writeLine: (line: string) => void;
  private readonly useClack: boolean;
  private readonly colorEnabled: boolean;
  private readonly projectLabel?: string;
  private readonly version?: string;
  private readonly columns?: number;
  private readonly colorDepth?: number;
  private readonly stdin?: ScanProgressRendererOptions['stdin'];

  private readonly clack: ClackPrompts | null;
  private started = false;
  /**
   * Set once the run is closed (finish/abort/fail). The scan keeps running
   * while the interrupt handler reports to the API, and work queued behind a
   * blocking phase must not draw new steps under "Scan cancelled".
   */
  private closed = false;
  private recognitionHandled = false;
  private activeStep: ScanUiStepId | null = null;
  private spinner: SpinnerHandle | null = null;
  private readonly completedSteps = new Set<ScanUiStepId>();
  private teachingSummaryLines: string[] = [];
  private previewUrl: string | undefined;
  private previewNotice: string | undefined;
  private uploadFailure: ScanUploadFailure | undefined;

  constructor(
    options: ScanProgressRendererOptions,
    clack: ClackPrompts | null
  ) {
    this.clack = clack;
    this.isTTY = options.isTTY;
    // Prefer explicit option over env (so tests can force color on/off).
    this.noColor =
      options.noColor !== undefined ? options.noColor : envNoColor();
    this.projectLabel = options.projectLabel
      ? formatProjectLabel(options.projectLabel)
      : undefined;
    this.version = options.version;
    this.columns = options.columns;
    this.colorDepth = options.colorDepth;
    this.stdin = options.stdin;
    this.writeLine =
      options.writeLine ??
      ((line: string) => {
        console.log(line);
      });
    // Clack for interactive TTY without NO_COLOR. Plain logs otherwise.
    this.useClack = this.isTTY && !this.noColor;
    this.colorEnabled = this.useClack;
  }

  /** Test helper: true when Clack chrome is active. */
  get usesClackChrome(): boolean {
    return this.useClack;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    const where = this.projectLabel
      ? `Let's scan ${this.projectLabel}`
      : "Let's scan your project";
    // Figlet only on a real terminal; CI logs get a single header line.
    const header = renderBrandHeader({
      version: this.version,
      color: this.colorEnabled,
      colorDepth: this.colorDepth,
      columns: this.columns,
      showLogo: this.isTTY,
    });

    if (this.useClack) {
      this.writeLine('');
      for (const line of header) this.writeLine(line);
      this.writeLine('');
      this.prompts().intro(where);
    } else {
      for (const line of header) this.writePlain(line);
      this.writePlain('────────────────');
      this.writePlain(where);
    }
  }

  onProgress(progress: ScanProgress): void {
    if (this.closed) return;
    this.start();
    switch (progress.phase) {
      case 'ingest':
        this.transitionTo('scanning_files');
        break;
      case 'analyze':
        this.transitionTo('analyzing');
        break;
      case 'classify':
        if (!this.recognitionHandled) {
          this.transitionTo('analyzing');
        }
        break;
      case 'ai_enrichment':
        this.transitionTo('ai_enrichment');
        break;
      case 'data_flow':
      case 'output':
      case 'idle':
      default:
        break;
    }
  }

  onRecognition(payload: ScanRecognitionPayload): void {
    if (this.closed) return;
    if (this.recognitionHandled) return;
    this.recognitionHandled = true;
    this.start();

    const groups = buildTeachingLineGroups(
      payload.findings,
      payload.components
    );
    this.teachingSummaryLines = flattenTeachingLines(groups);

    this.completeActiveStep();

    this.runTeachingStep(
      'detecting_frameworks',
      groups.routes.map((line) => line)
    );
    this.runTeachingStep(
      'mapping_data_stores',
      groups.stores.map((line) => line)
    );
    this.runTeachingStep(
      'finding_outbound',
      groups.outbound.map((line) => line)
    );

    if (this.teachingSummaryLines.length > 0) {
      const body = this.teachingSummaryLines
        .map((line) => `• ${line}`)
        .join('\n');
      if (this.useClack) {
        this.prompts().note(body, "Here's what stood out");
      } else {
        this.writePlain("Here's what stood out");
        for (const line of this.teachingSummaryLines) {
          this.writePlain(`  • ${line}`);
        }
      }
    }
  }

  /** Close the AI step with one plain-language result line. */
  onAiResult(result: ScanAiStepResult): void {
    if (this.closed) return;
    if (this.activeStep !== 'ai_enrichment') return;
    this.completeActiveStep();
    const line = formatAiStepResult(result);
    if (this.useClack) {
      this.prompts().log.message(line);
    } else {
      this.writePlain(`  · ${line}`);
    }
  }

  onWroteDataflow(outputPath?: string): void {
    if (this.closed) return;
    this.start();
    this.completeActiveStep();
    const label = 'Saved your data-flow map';
    if (this.useClack) {
      // The `[scan] dataflow.json written to` machine line is skipped in TTY,
      // so the path lives here.
      const where = outputPath
        ? `\n${paint(this.colorEnabled, 'dim', formatOutputPath(outputPath))}`
        : '';
      this.prompts().log.success(`${label}${where}`);
    } else {
      this.writePlain(`✓ ${label}`);
    }
  }

  /** Store preview URL for the "What to do next" note. Machine line stays in upload. */
  onPreviewUrl(previewUrl: string, notice?: string): void {
    if (this.closed) return;
    this.previewUrl = previewUrl;
    this.previewNotice = notice;
  }

  /**
   * Auto-upload failed after the local output was written. finish() then
   * says so and prints the retry command instead of the success closing.
   */
  onUploadFailed(failure: ScanUploadFailure): void {
    this.uploadFailure = failure;
  }

  /** One plain informational line, e.g. how many files the scan walks. */
  info(message: string): void {
    this.start();
    if (this.useClack) {
      this.prompts().log.info(message);
    } else {
      this.writePlain(message);
    }
  }

  /**
   * Non-fatal scan warning. Clack renders it inside the guide rail; plain mode
   * keeps the `[scan] …` stderr line scripts may grep for.
   */
  warn(message: string): void {
    if (this.closed) return;
    if (this.useClack) {
      this.prompts().log.warn(message);
    } else {
      console.warn(`[scan] ${message}`);
    }
  }

  /**
   * Technical meters (`--ai-verbose`, quota). Plain mode prints the raw lines;
   * Clack folds them into one dimmed note so they don't break the guide rail.
   */
  showTechnicalDetails(title: string, lines: string[]): void {
    if (this.closed) return;
    if (lines.length === 0) return;
    if (this.useClack) {
      const body = lines
        .map((line) => line.replace(/^\[scan\] ?/, ''))
        .map((line) => paint(this.colorEnabled, 'dim', line))
        .join('\n');
      this.prompts().note(body, title);
    } else {
      for (const line of lines) {
        this.writeLine(line);
      }
    }
  }

  finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.completeActiveStep();

    const nextSteps: string[] = [];
    let closing = 'All done — nice work.';
    if (this.uploadFailure) {
      const { reason, retryCommand, hint } = this.uploadFailure;
      nextSteps.push(`The upload did not complete: ${reason}.`);
      nextSteps.push(
        `Your scan is saved locally. To upload it, run:\n    ${retryCommand}`
      );
      if (hint) nextSteps.push(hint);
      closing = 'Scan finished. The upload did not complete.';
    } else if (this.previewUrl) {
      nextSteps.push(
        `Open your diagram:\n${formatPreviewLink(this.previewUrl, this.colorEnabled)}`
      );
      // Plain mode already got the notice from the upload's own log line.
      if (this.useClack && this.previewNotice) {
        nextSteps.push(this.previewNotice);
      }
    } else {
      nextSteps.push('Jump into DataParade to keep editing the diagram.');
    }

    if (this.useClack) {
      // Not a note(): it hard-wraps to the terminal width, which splits long
      // preview URLs and breaks click-to-open.
      this.prompts().log.step('What to do next');
      this.prompts().log.message(nextSteps.join('\n\n'));
      this.prompts().outro(closing);
    } else {
      this.writePlain('What to do next');
      for (const line of nextSteps) {
        // Preserve ANSI on the link line when color is on; strip elsewhere.
        if (this.colorEnabled && line.includes('http')) {
          this.writeLine(`  ${line}`);
        } else {
          this.writePlain(`  ${line}`);
        }
      }
      this.writePlain(closing);
    }
  }

  /**
   * Cancel an in-flight scan UI (Ctrl+C). Stops the spinner with a red mark
   * in Clack mode; prints a short line in plain mode. Does not run finish().
   */
  abort(message = 'Scan cancelled'): void {
    if (this.closed) return;
    this.closed = true;
    if (this.useClack && this.spinner) {
      if (typeof this.spinner.cancel === 'function') {
        this.spinner.cancel(message);
      } else {
        this.spinner.stop(message);
      }
      this.spinner = null;
      this.activeStep = null;
      return;
    }
    this.activeStep = null;
    if (this.useClack) {
      // Between steps: a raw line would break Clack's guide rail.
      this.prompts().log.warn(message);
      return;
    }
    this.writePlain(message);
  }

  /**
   * End the scan UI on an error: closes the active spinner with the error
   * mark (or logs an error line between steps). Does not run finish().
   */
  fail(message: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.useClack && this.spinner) {
      if (typeof this.spinner.error === 'function') {
        this.spinner.error(message);
      } else {
        this.spinner.stop(message);
      }
      this.spinner = null;
      this.activeStep = null;
      return;
    }
    this.activeStep = null;
    if (this.useClack) {
      this.prompts().log.error(message);
      return;
    }
    this.writePlain(message);
  }

  private transitionTo(step: ScanUiStepId): void {
    if (this.activeStep === step || this.completedSteps.has(step)) {
      return;
    }
    this.completeActiveStep();
    this.activeStep = step;
    const label = STEP_LABELS[step];
    if (this.useClack) {
      this.spinner = this.prompts().spinner({ withGuide: true });
      this.spinner.start(label);
      this.restoreSignalKeys();
    } else {
      this.writePlain(`… ${label}`);
    }
  }

  /**
   * Clack's spinner puts stdin in raw mode, where Ctrl+C is a keypress it
   * answers with process.exit(0) — skipping our SIGINT handler and leaving
   * the scan job running. The spinner only writes, so hand Ctrl+C back to
   * the terminal as a real signal.
   */
  private restoreSignalKeys(): void {
    const stdin = this.stdin;
    if (stdin?.isTTY && typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(false);
    }
  }

  private completeActiveStep(): void {
    if (!this.activeStep) return;
    const label = STEP_LABELS[this.activeStep];
    if (this.useClack && this.spinner) {
      this.spinner.stop(label);
      this.spinner = null;
    } else if (!this.useClack) {
      this.writePlain(`✓ ${label}`);
    }
    this.completedSteps.add(this.activeStep);
    this.activeStep = null;
  }

  private runTeachingStep(step: ScanUiStepId, teachingLines: string[]): void {
    if (this.completedSteps.has(step)) return;
    // Only show the step when there is something to teach, per AL-160.
    if (teachingLines.length === 0) return;

    const label = STEP_LABELS[step];
    if (this.useClack) {
      const spin = this.prompts().spinner({ withGuide: true });
      spin.start(label);
      spin.stop(label);
      for (const line of teachingLines) {
        this.prompts().log.message(line);
      }
    } else {
      this.writePlain(`✓ ${label}`);
      for (const line of teachingLines) {
        this.writePlain(`  · ${line}`);
      }
    }
    this.completedSteps.add(step);
  }

  private prompts(): ClackPrompts {
    if (!this.clack) {
      throw new Error('@clack/prompts is not loaded');
    }
    return this.clack;
  }

  private writePlain(line: string): void {
    const text = this.noColor ? line.replace(ANSI_PATTERN, '') : line;
    this.writeLine(text);
  }
}

export async function createScanProgressRenderer(
  options?: Partial<ScanProgressRendererOptions>
): Promise<ScanProgressRenderer> {
  const isTTY = options?.isTTY ?? Boolean(process.stdout.isTTY);
  const noColor =
    options?.noColor !== undefined ? options.noColor : envNoColor();
  const useClack = isTTY && !noColor;
  const clack = useClack ? (options?.prompts ?? (await loadClack())) : null;
  return new ScanProgressRenderer(
    {
      isTTY,
      noColor,
      writeLine: options?.writeLine,
      projectLabel: options?.projectLabel,
      version: options?.version,
      columns: options?.columns ?? process.stdout.columns,
      stdin: options?.stdin ?? process.stdin,
      colorDepth:
        options?.colorDepth ??
        (typeof process.stdout.getColorDepth === 'function'
          ? process.stdout.getColorDepth()
          : undefined),
    },
    clack
  );
}

/** Exported for tests. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

export function hasAnsi(text: string): boolean {
  // Avoid RegExp.lastIndex surprises with the global flag.
  return new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`).test(text);
}
