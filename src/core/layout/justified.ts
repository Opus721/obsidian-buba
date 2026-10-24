// Justified layout: tiles of different widths in rows of equal height, images not cropped. A greedy row
// layout following the Flickr justified-layout description (https://flickr.github.io/justified-layout/),
// without the library code: add images while the row at the target height is narrower than the grid; a row
// that reaches the width is stretched to exactly the width, taking whichever height is closer to the target:
// with the last image (below the target) or without it (above, but at most twice the target).

/** Tile of a row, px: index in the input list, left offset and width. */
export interface RowItem {
  readonly index: number;
  readonly left: number;
  readonly width: number;
}

/** Justified row, px: top offset, tile height without the gap, and the tiles in order. */
export interface Row {
  readonly top: number;
  readonly height: number;
  readonly items: readonly RowItem[];
}

const positive = (value: number): boolean => Number.isFinite(value) && value > 0;

/** Width / height ratio; not a number or <= 0 means square. */
function aspectAt(aspects: readonly number[], index: number): number {
  const value = aspects[index] ?? 1;
  return positive(value) ? value : 1;
}

/**
 * Justified layout. A full row is stretched to exactly the width and is at most twice the target height; the
 * last incomplete row has the target height and is not stretched. An image wider than the grid at the target
 * height gets its own row at full width, no taller than the target; the row before it is stretched if that
 * keeps it within twice the target, otherwise it stays incomplete at the target height. Tile order is kept.
 * Each index in `breaks` starts a new row, and the open row before it is closed by the same rule as a row
 * before a wide image: rows from a break do not depend on the ratios before it.
 */
export function justifiedRows(
  aspects: readonly number[],
  width: number,
  targetHeight: number,
  gap: number,
  breaks: readonly number[] = [],
): Row[] {
  const rows: Row[] = [];
  if (!positive(width) || !positive(targetHeight)) return rows;
  const g = positive(gap) ? gap : 0;
  const cuts = [...breaks].sort((a, b) => a - b);
  let cut = 0; // next break in `cuts`
  let top = 0;
  let start = 0; // first tile of the open row
  let sum = 0; // sum of the open row's ratios

  // Height at which tiles start..end-1 with gaps take exactly the width.
  const fitHeight = (end: number, aspectSum: number): number => (width - (end - start - 1) * g) / aspectSum;

  const close = (end: number, height: number): void => {
    const items: RowItem[] = [];
    let left = 0;
    for (let index = start; index < end; index += 1) {
      const itemWidth = aspectAt(aspects, index) * height;
      items.push({ index, left, width: itemWidth });
      left += itemWidth + g;
    }
    rows.push({ top, height, items });
    top += height + g;
    start = end;
    sum = 0;
  };

  // Closes the open row before it reaches the width.
  const closeShort = (end: number): void => {
    const height = fitHeight(end, sum);
    close(end, height <= 2 * targetHeight ? height : targetHeight);
  };

  for (let index = 0; index < aspects.length; index += 1) {
    while (cut < cuts.length && cuts[cut]! <= index) {
      if (cuts[cut] === index && index > start) closeShort(index);
      cut += 1;
    }
    const aspect = aspectAt(aspects, index);
    if (aspect * targetHeight >= width) {
      // Wider than the grid at the target height: a row of its own.
      if (index > start) closeShort(index);
      close(index + 1, width / aspect);
      continue;
    }
    const withIt = fitHeight(index + 1, sum + aspect);
    if (withIt > targetHeight) {
      sum += aspect; // the row is still narrower than the grid
      continue;
    }
    // With this image the row reaches the width. There are tiles before it in the row, since a single image
    // narrower than the grid does not fill a row. If the gaps alone are wider than the grid (withIt <= 0),
    // the row closes without it.
    const without = fitHeight(index, sum);
    if (withIt <= 0 || without - targetHeight < targetHeight - withIt) {
      closeShort(index);
      sum = aspect;
    } else {
      close(index + 1, withIt);
    }
  }
  if (start < aspects.length) close(aspects.length, targetHeight);
  return rows;
}

/**
 * Consecutive rows as shown: first tile, the tile after the last, tile ratios (width to the height of their
 * row), and row edges `cuts` (the start of each row and the tile after the last). With them as breaks,
 * `justifiedRows` lays them out the same way.
 */
export interface HeldRow {
  readonly start: number;
  readonly end: number;
  readonly aspects: readonly number[];
  readonly cuts: readonly number[];
}

/** Index of the last row that starts at or before tile `index`; 0 if there are no rows. */
export function rowAt(rows: readonly Row[], index: number): number {
  let low = 0;
  let high = rows.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((rows[middle]?.items[0]?.index ?? 0) <= index) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * Rows of layout `rows` from the row of tile `from` to the row of tile `index` inclusive, by default just the
 * row of tile `index`; `null` if there is no such tile. Their ratios with breaks `cuts` give the same rows in
 * `justifiedRows`, since the layout from a row start depends only on the ratios from there.
 */
export function heldRow(rows: readonly Row[], index: number, from = index): HeldRow | null {
  const last = rowAt(rows, index);
  const row = rows[last];
  const items = row?.items ?? [];
  const first = items[0];
  if (!row || !first || index < first.index || index >= first.index + items.length) return null;
  const aspects: number[] = [];
  const cuts: number[] = [];
  for (let at = Math.min(rowAt(rows, from), last); at <= last; at += 1) {
    const each = rows[at]!;
    cuts.push(each.items[0]!.index);
    for (const item of each.items) aspects.push(item.width / each.height);
  }
  const end = first.index + items.length;
  return { start: cuts[0]!, end, aspects, cuts: [...cuts, end] };
}

/** Layouts are equal: same rows of the same height, same tiles of the same width. */
function sameRows(a: readonly Row[], b: readonly Row[]): boolean {
  return (
    a.length === b.length &&
    a.every((row, at) => {
      const other = b[at]!;
      return (
        Math.abs(row.height - other.height) <= 1e-6 &&
        row.items.length === other.items.length &&
        row.items.every(
          (item, each) =>
            item.index === other.items[each]!.index &&
            Math.abs(item.width - other.items[each]!.width) <= 1e-6,
        )
      );
    })
  );
}

/**
 * Layout with a hold: rows restart at `breaks` and at the edges of the held rows `holds`, and the tiles of
 * row `row` keep their shown ratios. `held` means the hold matters: the layout from `aspects` with
 * `breaks` alone differs and must be recomputed when the hold is released. Otherwise the layout without
 * the hold is returned.
 */
export function heldRows(
  aspects: readonly number[],
  width: number,
  targetHeight: number,
  gap: number,
  breaks: readonly number[],
  holds: readonly number[],
  row: HeldRow | null,
): { readonly rows: Row[]; readonly held: boolean } {
  const free = justifiedRows(aspects, width, targetHeight, gap, breaks);
  if (holds.length === 0 && !row) return { rows: free, held: false };
  let shown = aspects;
  if (row) {
    const copy = [...aspects];
    copy.splice(row.start, row.aspects.length, ...row.aspects);
    shown = copy;
  }
  const rows = justifiedRows(shown, width, targetHeight, gap, [...breaks, ...holds]);
  return sameRows(rows, free) ? { rows: free, held: false } : { rows, held: true };
}

/**
 * Breaks with which the layout from the new ratios `aspectOf` keeps the rows from tile `first` as they are in
 * layout `rows` with breaks `breaks`: `first` itself and the breaks after it, up to and including the first
 * tile with a new ratio. Breaks before `first` do not change rows from it; past a new ratio the rows differ
 * anyway, and a break there would only leave a short row.
 */
export function keptBreaks(
  rows: readonly Row[],
  breaks: readonly number[],
  first: number,
  aspectOf: (index: number) => number,
): number[] {
  const last = breaks.reduce((max, at) => Math.max(max, at), first);
  let changed = Number.POSITIVE_INFINITY;
  scan: for (let at = rowAt(rows, first); at < rows.length; at += 1) {
    const row = rows[at]!;
    for (const item of row.items) {
      if (item.index < first) continue;
      if (item.index >= last) break scan;
      const value = aspectOf(item.index);
      if (Math.abs((positive(value) ? value : 1) - item.width / row.height) > 1e-6) {
        changed = item.index;
        break scan;
      }
    }
  }
  return [first, ...breaks.filter((at) => at > first && at <= changed)];
}
