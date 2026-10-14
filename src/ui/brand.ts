/**
 * Compact terminal brand mark. PNG logos don't render reliably in most
 * terminals, so we ship a small ASCII wordmark for TTY sessions.
 *
 * Upright mixed-case "DataParade". Letter gaps tuned so the second "a"
 * (after "t" in Data) is not more open than the rest.
 */
export const DATAPARADE_ASCII_LOGO = [
  ' ____         _          ____                        _',
  '|  _ \\  __ _ | |_  __ _ |  _ \\  __ _  _ __  __ _  __| |  ___',
  "| | | |/ _` || __|/ _` || |_) |/ _` || '__|/ _` |/ _` | / _ \\",
  '| |_| ||(_| || |_ |(_| ||  __/ |(_| || |   |(_| ||(_| ||  __/',
  '|____/ \\__,_| \\__|\\__,_||_|    \\__,_||_|   \\__,_|\\__,_| \\___|',
].join('\n');

export const DATAPARADE_TAGLINE = 'Map privacy data flows from your code';

/** Below this width the figlet wraps, so we fall back to a one-line header. */
export const BRAND_LOGO_MIN_COLUMNS = 64;

type Rgb = readonly [number, number, number];

// Top → bottom gradient, ending on --color-brand (#0c7377). The light end keeps
// the logo readable on dark terminals; the brand end on light ones.
const GRADIENT_FROM: Rgb = [0x3f, 0xb1, 0xb5];
const GRADIENT_TO: Rgb = [0x0c, 0x73, 0x77];
// xterm-256 approximations of the same ramp.
const GRADIENT_256 = [73, 73, 37, 30, 30];
const BRAND_256 = 30;

const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;

export interface BrandHeaderOptions {
  /** CLI version shown under the logo. */
  version?: string;
  /** When false, never emit ANSI escape codes. */
  color: boolean;
  /** Terminal color depth in bits (1, 4, 8, 24). */
  colorDepth?: number;
  /** Terminal width; undefined means "assume wide enough". */
  columns?: number;
  /** When false (CI / non-TTY), print only the one-line header. */
  showLogo: boolean;
}

function lerp(from: Rgb, to: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) =>
    Math.round(from[i]! + (to[i]! - from[i]!) * t)
  ) as unknown as Rgb;
}

function foreground(colorDepth: number, rgb: Rgb, ansi256: number): string {
  if (colorDepth >= 24) return `${ESC}[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  if (colorDepth >= 8) return `${ESC}[38;5;${ansi256}m`;
  return `${ESC}[36m`;
}

/**
 * Brand header lines: teal-gradient figlet + version/tagline on wide TTYs,
 * a single `DataParade vX · tagline` line otherwise.
 */
export function renderBrandHeader(options: BrandHeaderOptions): string[] {
  const { color, version } = options;
  const depth = options.colorDepth ?? 4;
  const brand = color ? foreground(depth, GRADIENT_TO, BRAND_256) : '';
  const bold = color ? BOLD : '';
  const dim = color ? DIM : '';
  const reset = color ? RESET : '';
  const versionLabel = version ? `v${version}` : '';
  const wide =
    options.columns === undefined || options.columns >= BRAND_LOGO_MIN_COLUMNS;

  if (!options.showLogo || !wide) {
    const name = `${bold}${brand}DataParade${reset}`;
    const ver = versionLabel ? ` ${dim}${versionLabel}${reset}` : '';
    return [`${name}${ver} ${dim}· ${DATAPARADE_TAGLINE}${reset}`];
  }

  const logoLines = DATAPARADE_ASCII_LOGO.split('\n');
  const last = logoLines.length - 1;
  const lines = logoLines.map((line, i) => {
    if (!color) return line;
    const rgb = lerp(GRADIENT_FROM, GRADIENT_TO, last > 0 ? i / last : 1);
    return `${bold}${foreground(depth, rgb, GRADIENT_256[i] ?? BRAND_256)}${line}${reset}`;
  });
  const ver = versionLabel ? `${bold}${brand}${versionLabel}${reset}  ` : '';
  lines.push('', `  ${ver}${dim}${DATAPARADE_TAGLINE}${reset}`);
  return lines;
}
