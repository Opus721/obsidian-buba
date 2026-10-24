// Ring around a color dot: only a color that is hard to see on the theme background gets a
// thin grey ring. The measure is WCAG 2.2 contrast, relative sRGB luminance and
// `(L1 + 0.05) / (L2 + 0.05)`, not luminance alone: neon #00ff8f, #00deff, #bfd300 on white
// give 1.3–1.7:1 while their luminance is below 0.8. Theme backgrounds and old preset colors
// are Obsidian's default theme values from app.css 1.13.7: `--background-primary` =
// `--color-base-00` and `--color-red` … `--color-pink` in `.theme-light` and `.theme-dark`. A
// custom theme may override them; the threshold still uses these values. No `obsidian` import.
import { isColorValue, isPresetColor, type HexColor, type PresetColor } from './value.ts';

export type Theme = 'light' | 'dark';
export const THEMES: readonly Theme[] = ['light', 'dark'];

/** Theme background `--background-primary` (`--color-base-00`, app.css 1.13.7): color/tag windows, notes. */
export const THEME_BACKGROUND: Readonly<Record<Theme, HexColor>> = { light: '#ffffff', dark: '#1c1c1c' };

/** Old presets: Obsidian's default theme colors (app.css 1.13.7, `.theme-light` and `.theme-dark`). */
export const PRESET_HEX: Readonly<Record<Theme, Readonly<Record<PresetColor, HexColor>>>> = {
  light: {
    red: '#e93147',
    orange: '#ec7500',
    yellow: '#e0ac00',
    green: '#08b94e',
    cyan: '#00bfbc',
    blue: '#086ddd',
    purple: '#7852ee',
    pink: '#d53984',
  },
  dark: {
    red: '#fb464c',
    orange: '#e9973f',
    yellow: '#e0de71',
    green: '#44cf6e',
    cyan: '#53dfdd',
    blue: '#027aff',
    purple: '#a882ff',
    pink: '#fa99cd',
  },
};

/** A dot whose contrast with the theme background is below 2:1 needs a ring. */
export const LOW_CONTRAST = 2;

/** sRGB channel 0–255 to linear, as in the WCAG relative luminance definition. */
function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of `#rrggbb`: 0 is black, 1 is white. */
export function luminance(hex: HexColor): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * linear((n >> 16) & 255) + 0.7152 * linear((n >> 8) & 255) + 0.0722 * linear(n & 255);
}

/** WCAG contrast of two colors: from 1 (equal) to 21 (black on white); order does not matter. */
export function contrast(a: HexColor, b: HexColor): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The value's color in a theme: custom hex as is, an old preset as the theme default; `null` if invalid. */
export function themeHex(value: unknown, theme: Theme): HexColor | null {
  if (!isColorValue(value)) return null;
  return isPresetColor(value) ? PRESET_HEX[theme][value] : value;
}

/** Themes whose background hides the dot (contrast below `LOW_CONTRAST`), so it gets a ring. */
export function lowContrastThemes(value: unknown): Theme[] {
  return THEMES.filter((theme) => {
    const hex = themeHex(value, theme);
    return hex !== null && contrast(hex, THEME_BACKGROUND[theme]) < LOW_CONTRAST;
  });
}
