// The iOS app's colour themes and background patterns (Models/AppTheme.swift,
// BakeriApp.swift BackgroundPattern, Theme/BakeriTheme.swift
// AppBackgroundPattern), light-mode values. Stored on profiles.selected_theme /
// background_pattern as the Swift rawValues, so a theme picked on the phone
// shows up here and vice versa — and the public storefront reads it too.
// Applied to the phone layout only; desktop keeps its own look.

export const THEMES = ['Classic', 'Macaron', 'Birthday', 'Tart', 'Sprinkle', 'Ember', 'Sage', 'Blueberry', 'Honey', 'Fall'] as const;
export type ThemeName = (typeof THEMES)[number];
export const PATTERNS = ['Standard', 'Polka Dot', 'Stripes', 'Gingham', 'Pumpkins'] as const;
export type PatternName = (typeof PATTERNS)[number];

interface ThemeDef {
  swatches: [string, string, string];
  primary: string;
  gold: string;
  background: string;
  buttonFg: string;
  /** Unselected tab bar items (uiUnselected). */
  unselected: string;
  /** Bold-header themes paint the nav bar in their first swatch. */
  bold: boolean;
  headerBg: string;
  headerFg: string;
}

const LIGHT_FG = '#2A2020';
const T = (swatches: [string, string, string], primary: string, gold: string, background: string, buttonFg: string, unselected: string, bold = false, headerBg = background, headerFg = '#1a130f'): ThemeDef =>
  ({ swatches, primary, gold, background, buttonFg, unselected, bold, headerBg, headerFg });

export const THEME_DEFS: Record<ThemeName, ThemeDef> = {
  Classic: T(['#1C1C1E', '#A89B8C', '#D9E3E2'], '#1C1C1E', '#C49A6C', '#FAF6EE', '#FFFFFF', '#A89B8C'),
  Macaron: T(['#FFE485', '#F698DB', '#E1EEAF'], '#D966B0', '#C8D87A', '#FDFAF0', LIGHT_FG, '#221028'),
  Birthday: T(['#FFD3E4', '#92D1FF', '#FFD058'], '#5AAEE0', '#FFD058', '#FFF4F8', LIGHT_FG, '#0C1624'),
  Tart: T(['#7E8435', '#FFD1D9', '#FF5E32'], '#7E8435', '#FF5E32', '#F8F4EC', '#FFFFFF', '#141608'),
  Sprinkle: T(['#F72967', '#46C6D7', '#BCACDD'], '#F72967', '#BCACDD', '#F7F2FC', '#FFFFFF', '#1E0814'),
  Ember: T(['#740001', '#EEBA30', '#D3A625'], '#AE0001', '#C9A227', '#FBF1E9', '#FFFFFF', '#4A1210', true, '#740001', '#FFFFFF'),
  Sage: T(['#1A472A', '#2A623D', '#AAAAAA'], '#2A623D', '#A8935C', '#F2F6F1', '#FFFFFF', '#163420', true, '#1A472A', '#FFFFFF'),
  Blueberry: T(['#0E1A40', '#222F5B', '#946B2D'], '#222F5B', '#946B2D', '#EEF1F8', '#FFFFFF', '#16223F', true, '#0E1A40', '#FFFFFF'),
  Honey: T(['#ECB939', '#726255', '#372E29'], '#ECB939', '#C99A3D', '#FBF5E7', LIGHT_FG, '#4A3F30', true, '#ECB939', LIGHT_FG),
  Fall: T(['#A63117', '#F25C05', '#D95A11'], '#BF3E0F', '#D95A11', '#FDF1E7', '#FFFFFF', '#5A2410', true, '#A63117', '#FFFFFF'),
};

export function asTheme(v: string | null | undefined): ThemeName {
  return (THEMES as readonly string[]).includes(v ?? '') ? (v as ThemeName) : 'Classic';
}
export function asPattern(v: string | null | undefined): PatternName {
  return (PATTERNS as readonly string[]).includes(v ?? '') ? (v as PatternName) : 'Standard';
}

const hexA = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
const svgURL = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/** Staggered polka dots cycling through the swatches — 52pt grid, 12pt radius, 15% opacity. */
function polkaDots(sw: string[]): string {
  const s = 52, r = 12;
  // Colour index = row*2 + col (mod 3) and odd rows shift half a cell, so the
  // pattern repeats every 3 columns and 6 rows.
  let dots = '';
  for (let row = 0; row < 6; row++) {
    for (let col = -1; col < 4; col++) {
      const x = col * s + (row % 2 ? s / 2 : 0), y = s / 2 + row * s;
      const c = sw[(((row * 2 + col) % 3) + 3) % 3];
      dots += `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" fill-opacity="0.15"/>`;
    }
  }
  return svgURL(`<svg xmlns="http://www.w3.org/2000/svg" width="${s * 3}" height="${s * 6}">${dots}</svg>`);
}

/**
 * CSS for the fixed page backdrop (.app-bg) and its image layer (.app-bg::after),
 * as AppBackgroundPattern draws them.
 */
export function backdropStyle(theme: ThemeName, pattern: PatternName): Record<string, string> {
  const t = THEME_DEFS[theme];
  const vars: Record<string, string> = { '--bg-layer': 'none', '--bg-layer-size': 'auto', '--bg-layer-color': 'transparent', '--bg-layer-blend': 'normal', '--bg-layer-opacity': '1', '--bg-pattern': 'none', '--bg-pattern-size': 'auto' };
  switch (pattern) {
    case 'Polka Dot':
      vars['--bg-pattern'] = polkaDots(t.swatches);
      vars['--bg-pattern-size'] = '156px 312px';
      break;
    case 'Stripes':
      vars['--bg-pattern'] = t.bold
        ? `repeating-linear-gradient(90deg, ${hexA(t.swatches[0], 0.65)} 0 24px, ${hexA(t.swatches[1], 0.65)} 24px 48px)`
        : `repeating-linear-gradient(90deg, ${hexA(t.primary, 0.07)} 0 24px, transparent 24px 48px)`;
      break;
    case 'Gingham':
      if (t.bold && theme !== 'Fall') {
        // Woven check: translucent horizontal bands of one swatch over vertical bands of another.
        vars['--bg-pattern'] = `repeating-linear-gradient(0deg, ${hexA(t.swatches[0], 0.65)} 0 22px, transparent 22px 44px), repeating-linear-gradient(90deg, ${hexA(t.swatches[1], 0.65)} 0 22px, transparent 22px 44px)`;
      } else {
        vars['--bg-layer'] = `url("${import.meta.env.BASE_URL}themes/gingham.jpg")`;
        vars['--bg-layer-size'] = '1024px 1024px';
        vars['--bg-layer-opacity'] = '0.10';
      }
      break;
    case 'Pumpkins': {
      vars['--bg-layer'] = `url("${import.meta.env.BASE_URL}themes/pumpkins.png")`;
      vars['--bg-layer-size'] = '736px 1308px';
      vars['--bg-layer-opacity'] = '0.5';
      if (theme !== 'Fall') {
        // Desaturated and colour-multiplied with the theme's tint, like the app.
        const tint = theme === 'Classic' ? t.gold : theme === 'Blueberry' ? '#5872B8' : t.bold ? t.swatches[0] : t.primary;
        vars['--bg-layer-color'] = tint;
        vars['--bg-layer-blend'] = 'luminosity';
      }
      break;
    }
    default:
      break;
  }
  return vars;
}

/** The theme's colours as CSS variables, consumed by the phone styles. */
export function themeVars(theme: ThemeName): Record<string, string> {
  const t = THEME_DEFS[theme];
  return {
    '--t-primary': t.primary,
    '--t-primary-soft': hexA(t.primary, 0.12),
    '--t-on-primary': t.buttonFg,
    '--t-bg': t.background,
    '--t-unselected': t.unselected,
    '--t-header-bg': t.bold ? t.headerBg : hexA(t.background, 0.82),
    '--t-header-fg': t.headerFg,
    '--t-header-glass': t.bold ? 'rgba(255, 255, 255, .16)' : 'rgba(255, 255, 255, .74)',
  };
}
