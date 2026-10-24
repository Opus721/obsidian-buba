// Color value of a tag, tag group or folder: a preset name meaning an Obsidian theme color (`--color-red` …
// `--color-pink`, follows the theme) or a custom `#rrggbb`, like colors on an Obsidian canvas. The value
// comes from the journal (another device, a manual edit) and goes into a style, so only a closed list of
// names and a strict hex pattern are accepted: nothing CSS could read as an expression. No `obsidian` import.

/**
 * Old presets: Obsidian theme colors `--color-<name>`. The color window
 * no longer offers them, but the journal stores them, so they are still
 * accepted and shown; otherwise those journal lines would become invalid.
 */
export const PRESET_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'] as const;

export type PresetColor = (typeof PRESET_COLORS)[number];
/** A custom color, always `#rrggbb` in lowercase. */
export type HexColor = `#${string}`;
export type ColorValue = PresetColor | HexColor;

const PRESETS: ReadonlySet<string> = new Set(PRESET_COLORS);
const HEX = /^#[0-9a-f]{6}$/;
const HEX_INPUT = /^#?([0-9a-f]{6})$/i;

export function isPresetColor(value: unknown): value is PresetColor {
  return typeof value === 'string' && PRESETS.has(value);
}

/** A value in canonical form: a preset name or lowercase `#rrggbb`. Anything else is not a color. */
export function isColorValue(value: unknown): value is ColorValue {
  return isPresetColor(value) || (typeof value === 'string' && HEX.test(value));
}

/**
 * HEX field input: `#A1B2C3`, `a1b2c3`, with surrounding spaces, becomes `#a1b2c3`; otherwise `null`. The
 * short form `#abc` is rejected: the window shows and stores one form.
 */
export function parseHexInput(text: string): HexColor | null {
  const match = HEX_INPUT.exec(text.trim());
  return match ? `#${match[1]!.toLowerCase()}` : null;
}

/**
 * Value for `style` (the dot color): a preset becomes an Obsidian theme variable, a custom color the checked
 * hex. Not a color gives `null` and the caller draws nothing.
 */
export function colorCss(value: unknown): string | null {
  if (isPresetColor(value)) return `var(--color-${value})`;
  return typeof value === 'string' && HEX.test(value) ? value : null;
}
