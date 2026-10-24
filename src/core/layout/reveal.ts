// Showing a tile, such as the first of just added files: the grid scrolls only if the tile is not fully
// visible, and then brings it to the top edge. The top edge, not the nearest one: the files added with it
// usually follow it in the sort and come into view below it, and the grid holds its top row when its width
// changes, as when the file panel slides out for the new selection, so the tile stays in view.

/** A vertical span in grid body coordinates, px. */
export interface Span {
  readonly top: number;
  readonly height: number;
}

/**
 * Where the tile should stand: the distance of its top from the viewport top, px, or `null` if it is already
 * fully visible. `pad` is the body padding the grid keeps between the viewport edge and a tile.
 */
export function revealOffset(tile: Span, view: Span, pad: number): number | null {
  const top = tile.top - view.top;
  if (top >= 0 && top + tile.height <= view.height) return null;
  return pad;
}
