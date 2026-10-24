// Uniform grid, like CSS Grid `repeat(auto-fill, minmax(<size>, 1fr))` with `gap`
// (https://developer.mozilla.org/en-US/docs/Web/CSS/repeat#auto-fill): as many columns as fit tiles of at
// least the given size with gaps only between them, and tiles stretched to the width. A grid narrower than
// one tile has one column with the tile shrunk to the width, so there is no horizontal scroll.

/** Uniform grid, px. */
export interface UniformGrid {
  /** Columns per row, at least one. */
  readonly columns: number;
  /** Side of the square tile: the columns with gaps take exactly the full width. */
  readonly tile: number;
  /** Row height without the gap, equal to the tile side; row `i` sits at `i * (rowHeight + gap)`. */
  readonly rowHeight: number;
  /** Rows for all tiles. */
  readonly rows: number;
}

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

/**
 * @param count number of tiles
 * @param width grid width
 * @param size tile size from the slider: the minimum, tiles stretch to the width
 * @param gap gap between tiles
 */
export function uniformGrid(count: number, width: number, size: number, gap: number): UniformGrid {
  const w = Math.max(0, finite(width));
  const g = Math.max(0, finite(gap));
  const s = Math.max(1, finite(size));
  const columns = Math.max(1, Math.floor((w + g) / (s + g)));
  const tile = (w - (columns - 1) * g) / columns;
  const rows = Math.ceil(Math.max(0, Math.floor(finite(count))) / columns);
  return { columns, tile, rowHeight: tile, rows };
}
