// Viewer zoom and pan, no `obsidian` import: the image is a rectangle in the window with free space
// around it, as on a canvas. The point under the cursor stays in place while zooming, like
// `zoomToPoint` in Panzoom (MIT).

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** `x`, `y`: the image's top-left corner in the window; `scale`: window points per image point. */
export interface ViewState {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 32;

/** This many wheel points double the scale: a mouse notch in Chromium is 100, i.e. x1.19. */
const WHEEL_DOUBLING = 400;

/**
 * Large images are fitted whole, small ones shown at 100%, centered, with the corner on whole points:
 * Chromium resamples the image by half a point on a fractional `transform` offset and it gets blurry at 100%,
 * so the remainder is split with rounding, as in PhotoSwipe. Unknown size means 100%.
 */
export function fitView(media: Size, box: Size): ViewState {
  const known = media.width > 0 && media.height > 0;
  const scale = known ? Math.min(1, box.width / media.width, box.height / media.height) : 1;
  return {
    scale,
    x: Math.round((box.width - media.width * scale) / 2),
    y: Math.round((box.height - media.height * scale) / 2),
  };
}

/**
 * Scale times `factor`, keeping the image point under `point` in place. The scale is clamped to
 * MIN_SCALE…MAX_SCALE; an image fitted below MIN_SCALE does not shrink further but does not jump up either.
 */
export function zoomAt(view: ViewState, factor: number, point: Point): ViewState {
  const low = Math.min(MIN_SCALE, view.scale);
  const high = Math.max(MAX_SCALE, view.scale);
  const scale = Math.min(high, Math.max(low, view.scale * factor));
  const ratio = scale / view.scale;
  return {
    scale,
    x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio,
  };
}

/** Unbounded pan: the image can be moved past the window edge. */
export function panBy(view: ViewState, dx: number, dy: number): ViewState {
  return { scale: view.scale, x: view.x + dx, y: view.y + dy };
}

/** Scale factor per wheel event: down (deltaY > 0) shrinks; the same amount back restores the scale. */
export function wheelFactor(deltaY: number): number {
  return 2 ** (-deltaY / WHEEL_DOUBLING);
}

/** Neighbouring list index; at the ends the same index, no wrap-around. */
export function neighbor(index: number, count: number, dir: -1 | 1): number {
  const next = index + dir;
  return next >= 0 && next < count ? next : index;
}
