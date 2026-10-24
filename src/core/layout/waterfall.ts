// "Columns" (waterfall) layout: tiles one column wide with height from the image ratio, each next tile goes
// into the shortest column, the left one on a tie, as in Eagle and Pinterest; the sort order reads left to
// right, top to bottom. Obsidian has no such layout of its own (the file explorer is a list, Bases "Cards" is
// an even grid), so it is our own, like justified. Columns are as in the uniform grid (`uniformGrid`). Core
// computes tile positions, not the virtualizer, because the grid needs them before rendering: for the
// selection rectangle, the scroll position and the hold.
//
// Heights, gap and caption are multiples of 1/64 px. Sums of such numbers are exact, so columns of the same
// tiles added in a different order are bit-equal and a tie is a real tie; without that, a column "shorter" by
// a rounding error (1e-13 px) took a tile from the left one. But the bottoms of columns made of different
// tiles still differ by fractions of a pixel (1/64-31/64): the right column, invisibly "shorter", took the
// tile, and a row at one height read right to left. So "shortest" is visual: a tile goes into the leftmost
// column whose bottom is less than `TIE` (half a pixel) below the shortest.

import { uniformGrid } from './uniform.ts';

/** A tall tile is at most this many column widths high; a longer image shows its top part. */
export const MAX_TALL = 5;

/** Safety cap on column content height, px; Chromium and WebKit cap element height at about 33.5M. */
export const MAX_HEIGHT = 30_000_000;

/**
 * Fraction of a px that heights, gap and caption are multiples of: 1/64 is invisible, and sums up to 30
 * million px stay exact.
 */
const STEP = 64;
const snap = (value: number): number => Math.round(value * STEP) / STEP;

/** Visual column tie, px: bottoms closer than this are one height, the tile goes left. 32/64 is exact. */
const TIE = 0.5;

/**
 * "Columns" layout, px. A tile is an image of height `thumb` with a caption `extra` below; tiles in a
 * column are `gap` apart.
 */
export interface Waterfall {
  /** Columns, at least one. */
  readonly columns: number;
  /** Column width: the columns with gaps take exactly the full width. */
  readonly width: number;
  /** Gap, a multiple of 1/64 px. */
  readonly gap: number;
  /** Caption height under the image, a multiple of 1/64 px. */
  readonly extra: number;
  /** Image height limit (`tallLimit`); images are no taller than it rounded down to 1/64 px. */
  readonly tall: number;
  /** Column of each tile by its index. */
  readonly column: Int32Array;
  /**
   * Tile top from the content start, a multiple of 1/64 px; grows with the index within a column. It is never
   * more than `TIE` above earlier tiles (a tile is placed no higher than the shortest column bottom + `TIE`),
   * and tiles at one visual height (tops less than `TIE` apart) go left to right by index.
   */
  readonly top: Float64Array;
  /** Tile image height without the caption, a multiple of 1/64 px. */
  readonly thumb: Float64Array;
  /** Tile indices of each column, top to bottom. */
  readonly byColumn: readonly Int32Array[];
  /** Content height: the bottom of the tallest column; 0 if there are no tiles. */
  readonly height: number;
  /**
   * The hold matters: held tiles are shown with ratios other than the current ones and the layout without the
   * hold differs. It must be recomputed when the hold is released, and while it holds, recomputed with a new
   * boundary (for example when scrolling stops); otherwise tiles held above the viewport keep their old ratio
   * forever. `false` without a hold or when it changes nothing.
   */
  readonly held: boolean;
}

/**
 * Hold: tiles before `upTo` keep their column, top and height from the shown layout `from`, the rest
 * continue from the column ends after them. Whoever holds checks that the first `upTo` tiles are the same
 * files in the same order.
 */
export interface WaterfallKeep {
  readonly upTo: number;
  readonly from: Waterfall;
}

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);
const positive = (value: number): boolean => Number.isFinite(value) && value > 0;

/**
 * Image height limit, px: `MAX_TALL` column widths, or lower when there are so many tiles that columns of
 * such tiles would exceed `MAX_HEIGHT`; a whole number of px, at least 1. It depends only on the tile count
 * and geometry, not on ratios, so an arriving preview does not change it.
 *
 * Why this works. The column that received its last tile was at that moment no taller than the shortest +
 * `TIE` (a visual tie), and the shortest is no taller than the average of the tiles placed so far: its bottom
 * is at most `pitch * ((count - 1) / columns + 1) - gap + TIE`, where pitch is the image, caption and gap of
 * the tallest tile. The limit takes the pitch at which this stays within `MAX_HEIGHT`. It holds until the
 * limit hits 1 px, which is about a million tiles per column.
 */
export function tallLimit(count: number, columns: number, width: number, gap: number, extra: number): number {
  const n = Math.max(1, Math.floor(finite(count)));
  const c = Math.max(1, Math.floor(finite(columns)));
  const w = Math.max(0, finite(width));
  const g = Math.max(0, finite(gap));
  const e = Math.max(0, finite(extra));
  const pitch = (MAX_HEIGHT - TIE + g) / ((n - 1) / c + 1);
  return Math.min(MAX_TALL * w, Math.max(1, Math.floor(pitch - e - g)));
}

/**
 * Image height: column width / ratio (not a number or <= 0 means square), to 1/64 px, no taller than the
 * limit rounded down to 1/64 px, so that neither the limit nor `MAX_HEIGHT` is exceeded.
 */
function thumbOf(aspect: number | undefined, width: number, tall: number): number {
  const value = aspect ?? 1;
  return Math.min(snap(width / (positive(value) ? value : 1)), Math.floor(tall * STEP) / STEP);
}

/**
 * "Columns" layout.
 * @param aspects image ratios, width / height, in tile order
 * @param width layout width
 * @param size tile size from the slider: the minimum column width, columns stretch to the width
 * @param gap gap between columns and between tiles in a column; rounded to 1/64 px
 * @param extra caption height under the image; rounded to 1/64 px
 * @param keep hold; used only with the same columns, column width, gap and caption, and when the height
 *   limit of `from` is not above the new one, otherwise the layout starts over
 */
export function waterfall(
  aspects: readonly number[],
  width: number,
  size: number,
  gap: number,
  extra: number,
  keep?: WaterfallKeep,
): Waterfall {
  const n = aspects.length;
  const g = snap(Math.max(0, finite(gap)));
  const e = snap(Math.max(0, finite(extra)));
  const { columns, tile } = uniformGrid(n, width, size, g);
  const tall = tallLimit(n, columns, tile, g, e);
  const column = new Int32Array(n);
  const top = new Float64Array(n);
  const thumb = new Float64Array(n);
  const ends = new Float64Array(columns).fill(-g); // column bottom; the next tile goes at `ends + g`
  const counts = new Int32Array(columns);
  const from = keep?.from;
  const same =
    from !== undefined &&
    from.columns === columns &&
    from.width === tile &&
    from.gap === g &&
    from.extra === e &&
    from.tall <= tall;
  const upTo = same ? Math.max(0, Math.min(Math.floor(finite(keep!.upTo)), n, from.top.length)) : 0;
  let held = false;
  for (let index = 0; index < upTo; index += 1) {
    const at = from!.column[index]!;
    column[index] = at;
    top[index] = from!.top[index]!;
    thumb[index] = from!.thumb[index]!;
    ends[at] = Math.max(ends[at]!, top[index]! + thumb[index]! + e);
    counts[at]! += 1;
    if (thumb[index] !== thumbOf(aspects[index], tile, tall)) held = true;
  }
  for (let index = upTo; index < n; index += 1) {
    // Visually shortest: the leftmost column whose bottom is less than `TIE` below the shortest `low`.
    let low = ends[0]!;
    for (let each = 1; each < columns; each += 1) low = Math.min(low, ends[each]!);
    let at = 0;
    while (ends[at]! >= low + TIE) at += 1;
    column[index] = at;
    top[index] = ends[at]! + g;
    thumb[index] = thumbOf(aspects[index], tile, tall);
    ends[at] = top[index]! + thumb[index]! + e;
    counts[at]! += 1;
  }
  const byColumn = Array.from({ length: columns }, (_, at) => new Int32Array(counts[at]!));
  const filled = new Int32Array(columns);
  for (let index = 0; index < n; index += 1) {
    const at = column[index]!;
    byColumn[at]![filled[at]!] = index;
    filled[at]! += 1;
  }
  let height = 0;
  for (const end of ends) height = Math.max(height, end);
  return { columns, width: tile, gap: g, extra: e, tall, column, top, thumb, byColumn, height, held };
}

/** Tile bottom, below the caption. */
const bottomOf = (layout: Waterfall, index: number): number =>
  layout.top[index]! + layout.thumb[index]! + layout.extra;

/**
 * Position in column `ids` of the first tile whose bottom is below `y`; the column length if
 * none. Binary search.
 */
function firstBelow(layout: Waterfall, ids: Int32Array, y: number): number {
  let low = 0;
  let high = ids.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (bottomOf(layout, ids[middle]!) <= y) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Tiles touching band `[from, to)`: bottom below `from`, top above `to`. By column, top to
 * bottom within a column.
 */
export function tilesIn(layout: Waterfall, from: number, to: number, visit: (index: number) => void): void {
  for (const ids of layout.byColumn) {
    for (let at = firstBelow(layout, ids, from); at < ids.length; at += 1) {
      const index = ids[at]!;
      if (layout.top[index]! >= to) break;
      visit(index);
    }
  }
}

/** Lowest index of a tile visible from viewport top `y` (bottom below `y`); `undefined` if all are above. */
export function firstVisible(layout: Waterfall, y: number): number | undefined {
  let best: number | undefined;
  for (const ids of layout.byColumn) {
    const at = firstBelow(layout, ids, y);
    if (at < ids.length && (best === undefined || ids[at]! < best)) best = ids[at]!;
  }
  return best;
}

/**
 * The hold's `upTo` for viewport top `y`: 1 + the highest index of a tile entirely above the viewport (bottom
 * <= `y`); 0 if none. With columns, a tile with an index above the first visible one can be entirely above
 * the viewport in a neighbouring column: a hold up to the first visible tile would not hold it, and its new
 * ratio would shift the visible tiles. Visible tiles with lower indices are held as shown.
 */
export function holdUpTo(layout: Waterfall, y: number): number {
  let upTo = 0;
  for (const ids of layout.byColumn) {
    const at = firstBelow(layout, ids, y);
    if (at > 0) upTo = Math.max(upTo, ids[at - 1]! + 1);
  }
  return upTo;
}
