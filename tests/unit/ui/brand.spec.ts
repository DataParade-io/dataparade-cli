import {
  BRAND_LOGO_MIN_COLUMNS,
  DATAPARADE_TAGLINE,
  renderBrandHeader,
} from '../../../src/ui/brand';
import { hasAnsi, stripAnsi } from '../../../src/ui/scan-progress-renderer';

describe('renderBrandHeader', () => {
  it('prints the figlet with version and tagline on a wide color TTY', () => {
    const lines = renderBrandHeader({
      version: '1.2.3',
      color: true,
      colorDepth: 24,
      columns: 120,
      showLogo: true,
    });
    const plain = lines.map(stripAnsi);
    expect(plain[0]).toContain('____');
    expect(plain.at(-1)).toBe(`  v1.2.3  ${DATAPARADE_TAGLINE}`);
    // Truecolor gradient ending on --color-brand #0c7377.
    expect(lines[4]).toContain('38;2;12;115;119');
  });

  it('falls back to 256 colors and basic cyan on shallower terminals', () => {
    const [first256] = renderBrandHeader({
      color: true,
      colorDepth: 8,
      showLogo: true,
    });
    expect(first256).toContain('38;5;');
    const [first16] = renderBrandHeader({
      color: true,
      colorDepth: 4,
      showLogo: true,
    });
    expect(first16).toContain('[36m');
  });

  it('uses one line on narrow terminals', () => {
    const lines = renderBrandHeader({
      version: '1.2.3',
      color: false,
      columns: BRAND_LOGO_MIN_COLUMNS - 1,
      showLogo: true,
    });
    expect(lines).toEqual([`DataParade v1.2.3 · ${DATAPARADE_TAGLINE}`]);
  });

  it('skips the figlet and ANSI in CI / non-TTY', () => {
    const lines = renderBrandHeader({
      version: '1.2.3',
      color: false,
      showLogo: false,
    });
    expect(lines).toHaveLength(1);
    expect(hasAnsi(lines[0]!)).toBe(false);
  });
});
