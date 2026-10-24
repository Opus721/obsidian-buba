// Pinch, finger pan and double tap on an image in the phone viewer, with the behaviour and numbers of
// Obsidian's own image viewer (the lightbox in app.js 1.13.7 and 1.14.4: handlePinchMove, endPinch,
// startSinglePointerGesture, applyGestureMove, applyPanMove, clampPan, getMaxPanBounds, startMomentum,
// checkDoubleTap, applyDoubleTapZoom; the numbers are the same in both versions). obsidian.d.ts does not
// expose this viewer, so the behaviour and numbers are repeated here. Pinch-to-close (Obsidian's `< 0.75`) is
// not repeated: zooming out to 10% of fit is kept. Pinch edges are not repeated either: in Obsidian a pinch
// is clamped to the edges, so at low zoom the image does not follow the fingers; here the edges are soft
// during the pinch, and on release the image returns to the clamp of the same scale, like PhotoSwipe 5.4.4
// (`zoom-handler.js`: pinch pan without `correctPan`, `correctZoomPan` at the end) and iPhone Photos. No
// Obsidian and no DOM: the viewer (src/assets/viewer/viewer.ts) supplies points in stage coordinates, time
// and the view. The desktop wheel and middle button are in zoom.ts, with free space around the image; finger
// pan and momentum clamp to the edges, as in Obsidian.
import { panBy, type Point, type Size, type ViewState } from './zoom.ts';

/** Pinch range: 0.1x to 10x of fit, also between gestures. */
export const PINCH_MIN = 0.1;
export const PINCH_MAX = 10;
/** Below the start scale a pinch goes no further than this share of fit. */
export const PINCH_FLOOR = PINCH_MIN;
/** Double tap zooms to this many times fit. */
export const DOUBLE_TAP_ZOOM = 2.5;
/** The second tap comes sooner than this after the first, ms… */
export const DOUBLE_TAP_MS = 300;
/** …and closer than this to it, px. */
export const DOUBLE_TAP_PX = 40;
/** A tap: the finger moved less than this from the start on each axis, px. */
export const TAP_SLOP_PX = 10;
/** Panning a zoomed image starts once the finger has moved this far from the start, px. */
export const PAN_START_PX = 5;
/** Return and double tap animations take this long, ms, with the `EASING` curve (swipe.ts). */
export const ZOOM_MS = 250;
/** Momentum after a pan starts from this speed, px/ms… */
export const MOMENTUM_MIN_SPEED = 0.03;
/** …halves the speed every this many ms… */
export const MOMENTUM_HALF_MS = 200;
/** …and stops below this, px/ms. */
export const MOMENTUM_STOP_SPEED = 0.1 / 16;
/** The first momentum frame is counted as this long, ms. */
export const MOMENTUM_FIRST_MS = 16;

/** The image in the stage: original size, stage size and the fitted view, which is 1x. */
export interface Frame {
  size: Size;
  box: Size;
  fit: ViewState;
}

/** Pinch start: the view, the center of the two fingers and the distance between them. */
export interface Pinch {
  view: ViewState;
  center: Point;
  distance: number;
}

/** How a touch ended: animate to a view, start pan momentum, or nothing. */
export type ZoomEnd = { animate: ViewState } | { momentum: Point } | null;

/**
 * Scale tolerance: the wheel there and back returns the fitted scale with a rounding error, and such an image
 * is not zoomed (like the viewer's `#swipeAllowed`).
 */
const EPSILON = 1e-9;

/** "At the edge" tolerance, px: half a point is below a visible shift. */
const EDGE_SLACK_PX = 0.5;

/** The image is larger than fitted. */
export function isZoomed(view: ViewState, frame: Frame): boolean {
  return view.scale > frame.fit.scale * (1 + EPSILON);
}

/**
 * Edge clamp: on an axis where the image is larger than the stage, its edge does not leave the stage edge;
 * where it is smaller, it is centered with the corner on whole points, like the fitted view (`fitView`). The
 * scale does not change.
 */
export function clampView(view: ViewState, frame: Frame): ViewState {
  const axis = (at: number, media: number, box: number): number => {
    const length = media * view.scale;
    return length <= box ? Math.round((box - length) / 2) : Math.min(0, Math.max(box - length, at));
  };
  return {
    scale: view.scale,
    x: axis(view.x, frame.size.width, frame.box.width),
    y: axis(view.y, frame.size.height, frame.box.height),
  };
}

/**
 * The image top is at the stage top: a finger can no longer move it down, which lets a zoomed image use the
 * swipe down, as in iPhone Photos. An image taller than the stage has its corner no lower than the top (the
 * edge clamp sets `y <= 0`), with half a point of tolerance; a shorter one is centered with `y > 0` and
 * cannot move down either.
 */
export function atTopEdge(view: ViewState): boolean {
  return view.y >= -EDGE_SLACK_PX;
}

/**
 * The stage changed size (phone rotation, desktop window): maps the view in frame `from` to frame `to`. A
 * non-zoomed image keeps the same level relative to fit, centered; a zoomed one keeps the same level, and the
 * image point under the stage center stays under the center. Edges are not clamped: for touch the first move
 * clamps them (`TouchZoom.move`), as in Obsidian, whose image viewer reads pan bounds live
 * (`getMaxPanBounds`); the desktop wheel and middle button keep free space around the image (zoom.ts).
 */
export function refitView(view: ViewState, from: Frame, to: Frame): ViewState {
  if (Math.abs(view.scale / from.fit.scale - 1) <= EPSILON) return to.fit;
  const scale = (view.scale / from.fit.scale) * to.fit.scale;
  if (!isZoomed(view, from))
    return clampView({ ...to.fit, scale: Math.max(PINCH_MIN * to.fit.scale, scale) }, to);
  const u = {
    x: (from.box.width / 2 - view.x) / view.scale,
    y: (from.box.height / 2 - view.y) / view.scale,
  };
  return { scale, x: to.box.width / 2 - u.x * scale, y: to.box.height / 2 - u.y * scale };
}

/**
 * Pinch view: the scale is the start scale times the distance ratio, 0.1x to 10x; the image point under the
 * fingers' center at the start stays under their current center at any zoom. Edges are soft during the pinch,
 * clamped on release (`releaseView`).
 */
export function pinchView(start: Pinch, center: Point, distance: number, frame: Frame): ViewState {
  const ratio = start.distance > 0 ? distance / start.distance : 1;
  const from = start.view.scale / frame.fit.scale;
  const level = Math.min(PINCH_MAX, Math.max(PINCH_MIN, from * ratio));
  const scale = level * frame.fit.scale;
  const k = scale / start.view.scale;
  return {
    scale,
    x: center.x - (start.center.x - start.view.x) * k,
    y: center.y - (start.center.y - start.view.y) * k,
  };
}

/**
 * Pinch released or cancelled: where to animate the image, which is the edge clamp of the same scale
 * (centered when smaller than fit), or the lower limit if below it; `null` if the image is already in place.
 * A permitted zoom-out is kept.
 */
export function releaseView(view: ViewState, frame: Frame): ViewState | null {
  const floor = PINCH_MIN * frame.fit.scale;
  const target = clampView({ ...view, scale: Math.max(floor, view.scale) }, frame);
  const same =
    target.scale === view.scale &&
    Math.abs(target.x - view.x) < EPSILON &&
    Math.abs(target.y - view.y) < EPSILON;
  return same ? null : target;
}

/**
 * Double tap at `point`: a zoomed image goes back to fit; otherwise 2.5x fit, with the image point under the
 * tap moved to the stage center, clamped to the edges.
 */
export function doubleTapView(view: ViewState, point: Point, frame: Frame): ViewState {
  if (isZoomed(view, frame)) return frame.fit;
  const scale = DOUBLE_TAP_ZOOM * frame.fit.scale;
  const u = { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
  return clampView(
    { scale, x: frame.box.width / 2 - u.x * scale, y: frame.box.height / 2 - u.y * scale },
    frame,
  );
}

/** A released pan keeps rolling with momentum if its speed is at least `MOMENTUM_MIN_SPEED`. */
export function momentumStarts(velocity: Point): boolean {
  return Math.hypot(velocity.x, velocity.y) >= MOMENTUM_MIN_SPEED;
}

/** Momentum frame of `dt` ms: move by speed times time, the speed decays; `done` means no more frames. */
export function momentumStep(
  velocity: Point,
  dt: number,
): { dx: number; dy: number; velocity: Point; done: boolean } {
  const k = 0.5 ** (dt / MOMENTUM_HALF_MS);
  const next = { x: velocity.x * k, y: velocity.y * k };
  return {
    dx: velocity.x * dt,
    dy: velocity.y * dt,
    velocity: next,
    done: next.x * next.x + next.y * next.y < MOMENTUM_STOP_SPEED * MOMENTUM_STOP_SPEED,
  };
}

/** Where and when a tap was lifted, for the double tap. */
interface Tap extends Point {
  t: number;
}

const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const apart = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
/** Smoothed speed, as in Obsidian: half new, half old, px/ms. */
const smooth = (was: number, step: number, dt: number): number => 0.5 * (step / dt) + 0.5 * was;

/**
 * Touches on the image: fingers, pinch, one-finger pan of a zoomed image, and double tap. A touch that had
 * two or more fingers counts as neither a tap nor a double tap. A finger left after a pinch immediately drags
 * a zoomed image, like iPhone Photos and PhotoSwipe 5.4.4 (`onPointerUp`: "we need to reinitiate drag"),
 * unlike Obsidian (`startPinch` blocks panning until release): a deliberate departure. The remaining finger
 * does not move a zoomed-out or fitted image. The swipe down is separate (`DismissSwipe`, swipe.ts): for a
 * non-zoomed image, and for a zoomed one when its top is at the stage top (`atTopEdge`). The viewer reads the
 * fingers this machine holds (`fingers`) to forget those no longer on screen.
 */
export class TouchZoom {
  readonly #fingers = new Map<number, Point>();
  #pinch: Pinch | null = null;
  /** This touch had two or more fingers. */
  #multi = false;
  /** The touch started on a zoomed image: one finger pans it. */
  #canPan = false;
  /** The pan threshold is passed: the finger moves the image. */
  #panning = false;
  /** The finger moved `TAP_SLOP_PX` or more from the start: no longer a tap. */
  #moved = false;
  #start: Point = { x: 0, y: 0 };
  #last: Point = { x: 0, y: 0 };
  #lastT = 0;
  #velocity: Point = { x: 0, y: 0 };
  /** The previous tap, the first of a possible double tap. */
  #tap: Tap | null = null;

  /** A pinch or pan is running: the viewer cancels the browser action. */
  get busy(): boolean {
    return this.#pinch !== null || this.#panning;
  }

  /** Fingers the touch holds: down and not yet lifted or cancelled. */
  get fingers(): number[] {
    return [...this.#fingers.keys()];
  }

  /** A finger touched down at stage point `point`; `view` is the current view. A second finger pinches. */
  down(id: number, point: Point, t: number, view: ViewState, frame: Frame): void {
    this.#fingers.set(id, point);
    if (this.#fingers.size === 1) {
      this.#pinch = null;
      this.#multi = false;
      this.#canPan = isZoomed(view, frame);
      this.#panning = false;
      this.#moved = false;
      this.#start = point;
      this.#last = point;
      this.#lastT = t;
      this.#velocity = { x: 0, y: 0 };
      return;
    }
    this.#multi = true;
    this.#panning = false;
    if (this.#fingers.size === 2) this.#startPinch(view);
  }

  /** A finger moved: the new image view, or `null` if the view does not change. */
  move(id: number, point: Point, t: number, view: ViewState, frame: Frame): ViewState | null {
    if (!this.#fingers.has(id)) return null;
    this.#fingers.set(id, point);
    if (this.#pinch) {
      if (this.#fingers.size !== 2) return null;
      const [a, b] = this.#pair();
      return pinchView(this.#pinch, middle(a, b), apart(a, b), frame);
    }
    const dx = point.x - this.#start.x;
    const dy = point.y - this.#start.y;
    if (Math.abs(dx) >= TAP_SLOP_PX || Math.abs(dy) >= TAP_SLOP_PX) this.#moved = true;
    if (!this.#canPan) return null;
    if (!this.#panning) {
      if (Math.hypot(dx, dy) < PAN_START_PX) return null;
      this.#panning = true;
      this.#lastT = t;
    }
    const step = { x: point.x - this.#last.x, y: point.y - this.#last.y };
    const dt = t - this.#lastT;
    if (dt > 0)
      this.#velocity = {
        x: smooth(this.#velocity.x, step.x, dt),
        y: smooth(this.#velocity.y, step.y, dt),
      };
    this.#last = point;
    this.#lastT = t;
    return clampView(panBy(view, step.x, step.y), frame);
  }

  /**
   * Finger lifted at `point`. A pinch keeps the view; a pan released fast gets momentum; a second tap close
   * by and in time is a double tap.
   */
  up(id: number, point: Point, t: number, view: ViewState, frame: Frame): ZoomEnd {
    if (!this.#fingers.delete(id)) return null;
    if (this.#pinch) return this.#endPinch(view, frame);
    if (this.#fingers.size > 0) return null;
    if (this.#panning) {
      this.#panning = false;
      return momentumStarts(this.#velocity) ? { momentum: this.#velocity } : null;
    }
    if (this.#multi) return null;
    const away = Math.max(Math.abs(point.x - this.#start.x), Math.abs(point.y - this.#start.y));
    if (this.#moved || away >= TAP_SLOP_PX) return null;
    const tap = { x: point.x, y: point.y, t };
    const prev = this.#tap;
    if (prev && t - prev.t < DOUBLE_TAP_MS && apart(prev, tap) < DOUBLE_TAP_PX) {
      this.#tap = null;
      return { animate: doubleTapView(view, point, frame) };
    }
    this.#tap = tap;
    return null;
  }

  /**
   * The browser cancelled the touch or the viewer forgot the finger (it is no longer on screen): no momentum
   * and no tap; a permitted scale is kept, and so is the previous tap (the first of a double). `frame` is
   * `null` when the image under the pinch is gone: the finger is removed without animation.
   */
  cancel(id: number, view: ViewState, frame: Frame | null): ZoomEnd {
    if (!this.#fingers.delete(id)) return null;
    if (this.#pinch) return this.#endPinch(view, frame);
    if (this.#fingers.size === 0) this.#panning = false;
    return null;
  }

  /** Forget the touches and the previous tap: the viewer changed content or closed. */
  reset(): void {
    this.#fingers.clear();
    this.#pinch = null;
    this.#multi = false;
    this.#canPan = false;
    this.#panning = false;
    this.#tap = null;
  }

  /**
   * Two or more fingers left: a new pinch from the current pair with this view. Fewer: the pinch ended, and
   * an image past the edge animates back to the clamp. If one finger is left, the pan starts over from its
   * point: the `PAN_START_PX` threshold from there, speed from zero, for a zoomed image. Its pan is already
   * clamped to the edges: the viewer stops the return as soon as the finger moves the image.
   */
  #endPinch(view: ViewState, frame: Frame | null): ZoomEnd {
    if (this.#fingers.size >= 2) {
      this.#startPinch(view);
      return null;
    }
    this.#pinch = null;
    this.#panning = false;
    this.#canPan = false;
    const [rest] = this.#fingers.values();
    if (rest && frame) {
      this.#canPan = isZoomed(view, frame);
      this.#start = rest;
      this.#last = rest;
      this.#velocity = { x: 0, y: 0 };
    }
    const back = frame && releaseView(view, frame);
    return back ? { animate: back } : null;
  }

  #startPinch(view: ViewState): void {
    const [a, b] = this.#pair();
    this.#pinch = { view, center: middle(a, b), distance: apart(a, b) };
  }

  /** The first two fingers of the touch. */
  #pair(): [Point, Point] {
    const [a = { x: 0, y: 0 }, b = a] = this.#fingers.values();
    return [a, b];
  }
}
