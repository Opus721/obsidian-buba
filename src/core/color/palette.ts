// Rows of the color window, without Obsidian. The top row is fixed: bright colors, the same in
// both themes. The window no longer offers the old theme presets `red…pink`, but shows the current
// one as a marked dot because the journal still stores them. Recent colors work like recent tags
// (src/core/tags/suggest.ts, `pushRecent`): the chosen one first, duplicates removed, the tail
// cut; they live in the device's local storage (src/platform/color/recent.ts). The caller stores
// pinned colors (tags keep them in the vault journal) and passes them through `PinnedColors`. Both
// are limited to eight; at the limit nothing can be pinned until one is unpinned. Everything that
// comes from outside is checked against the `value.ts` pattern before it is shown.
import { isColorValue, isPresetColor, type ColorValue, type HexColor } from './value.ts';

/**
 * The fixed top "Palette" row, ordered by spectrum. Only the display order may change: the set stays the
 * same, so saved colors and journals are unaffected.
 */
export const FIXED_COLORS: readonly HexColor[] = [
  '#ff007e',
  '#ff9c00',
  '#bfd300',
  '#00ff8f',
  '#00deff',
  '#4ea7fc',
  '#b18cff',
  '#ff00f8',
  '#ff00a5',
  '#ff7ab9',
];

const FIXED: ReadonlySet<string> = new Set(FIXED_COLORS);

/** How many recent custom colors the device remembers. */
export const RECENT_MAX = 8;
/** How many colors can be pinned; beyond that one must be unpinned first. */
export const PINNED_MAX = 8;

/**
 * Pinned colors stored by the caller: tags keep them in the vault journal,
 * folder colors likewise. The window reads `list()` on every row render,
 * calls `pin` and `unpin` from the icon next to a color and awaits the write.
 */
export interface PinnedColors {
  list(): readonly ColorValue[];
  pin(value: ColorValue): Promise<void>;
  unpin(value: ColorValue): Promise<void>;
}

/** A custom `#rrggbb` color, not a preset. */
export function isHexColor(value: unknown): value is HexColor {
  return isColorValue(value) && !isPresetColor(value);
}

/** A custom color outside the top row: worth remembering in recent colors. */
function isOwnColor(value: unknown): value is HexColor {
  return isHexColor(value) && !FIXED.has(value);
}

/**
 * The window's top row: the fixed colors, plus the current old theme color at the end as a marked dot unless
 * it is pinned (then it is already visible). A current custom color is not added: it shows in the HEX field.
 */
export function topRow(current: unknown, pinned: readonly unknown[]): ColorValue[] {
  const old = isPresetColor(current) && !pinned.includes(current);
  return old ? [...FIXED_COLORS, current] : [...FIXED_COLORS];
}

/** Colors of the list in order: only values matching the pattern, without duplicates. */
function uniqueColors(list: readonly unknown[]): ColorValue[] {
  return [...new Set(list.filter(isColorValue))];
}

/** Saved recent colors: only custom colors, no duplicates, at most `max`; a non-array gives none. */
export function readRecentColors(saved: unknown, max = RECENT_MAX): HexColor[] {
  if (!Array.isArray(saved)) return [];
  return uniqueColors(saved).filter(isHexColor).slice(0, max);
}

/**
 * Recent colors after a pick: the custom color first, its old place removed, the tail cut to `max`. Top-row
 * colors, old presets and "no color" are not remembered (the top row is always visible, presets are no longer
 * offered); the list then stays as it was.
 */
export function pushRecentColor(recent: readonly HexColor[], value: unknown, max = RECENT_MAX): HexColor[] {
  if (!isOwnColor(value)) return recent.slice(0, max);
  return [value, ...recent.filter((item) => item !== value)].slice(0, max);
}

/** What "Pin" will do: pin, already pinned, limit reached (unpin first), or not a color. */
export type PinPlan = 'pin' | 'already' | 'full' | 'invalid';

export function planPin(pinned: readonly unknown[], value: unknown, max = PINNED_MAX): PinPlan {
  if (!isColorValue(value)) return 'invalid';
  const current = uniqueColors(pinned);
  if (current.includes(value)) return 'already';
  return current.length >= max ? 'full' : 'pin';
}

/**
 * Window rows: pinned shows everything storage returned, even over the limit, because
 * the user must see them to unpin; recent shows custom colors that are neither pinned
 * nor in the top row, so no color sits in two rows, at most `RECENT_MAX`.
 */
export function colorRows(
  recent: readonly unknown[],
  pinned: readonly unknown[],
): { pinned: ColorValue[]; recent: HexColor[] } {
  const shown = uniqueColors(pinned);
  const rest = uniqueColors(recent)
    .filter(isOwnColor)
    .filter((value) => !shown.includes(value));
  return { pinned: shown, recent: rest.slice(0, RECENT_MAX) };
}
