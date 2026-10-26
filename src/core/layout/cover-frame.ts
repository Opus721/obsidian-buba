// Geometry of a framed folder cover (`CoverFrame`, src/core/storage/types.ts): the cover is the background of
// a box in the folder tile, the back plate or the slanted front (folder-tiles.css), sized like `cover` and then
// enlarged by `zoom`; `x` and `y` place it like `background-position` in percent. No DOM: tested alone.
import type { CoverFrame } from '../storage/types.ts';

/** Width to height of the back plate in the square folder tile: 87.5 % wide, 65 % high. */
export const BACK_BOX = 0.875 / 0.65;
/** Width to height of the slanted front: the whole width, 55.6 % high. */
export const FRONT_BOX = 1 / 0.556;

/** Frame of a cover that was never moved: in the middle, just filling the box. */
export const MIDDLE: CoverFrame = { x: 50, y: 50, zoom: 1 };

/** Zoom limits of "Move cover". */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/**
 * Background size in percent of the box for a picture of width-to-height `picture` in a box of `box`: filling
 * it like `cover`, then `zoom` times larger.
 */
export function coverSize(picture: number, box: number, zoom: number): { w: number; h: number } {
  if (!(picture > 0) || !(box > 0)) return { w: 100 * zoom, h: 100 * zoom };
  return picture > box
    ? { w: (100 * zoom * picture) / box, h: 100 * zoom }
    : { w: 100 * zoom, h: (100 * zoom * box) / picture };
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * The frame after the pointer moved `dx`, `dy` px over a box of `width` × `height` px whose background is
 * `size` percent of it: the picture follows the pointer. Along a side where the picture does not overflow
 * the box nothing moves.
 */
export function panFrame(
  frame: CoverFrame,
  dx: number,
  dy: number,
  width: number,
  height: number,
  size: { w: number; h: number },
): CoverFrame {
  const spareX = (width * (size.w - 100)) / 100;
  const spareY = (height * (size.h - 100)) / 100;
  return {
    x: spareX > 0.5 ? clamp(frame.x - (dx / spareX) * 100, 0, 100) : frame.x,
    y: spareY > 0.5 ? clamp(frame.y - (dy / spareY) * 100, 0, 100) : frame.y,
    zoom: frame.zoom,
  };
}

/** The frame zoomed by `factor` (a wheel step or a pinch), within `MIN_ZOOM`–`MAX_ZOOM`. */
export function zoomFrame(frame: CoverFrame, factor: number): CoverFrame {
  return { ...frame, zoom: clamp(frame.zoom * factor, MIN_ZOOM, MAX_ZOOM) };
}
