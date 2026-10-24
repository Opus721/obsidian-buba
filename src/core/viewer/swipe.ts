// Swipe down closes the viewer on touch devices, the gesture of Obsidian's own image viewer (the lightbox in
// app.js 1.13.7 and 1.14.4: detectGesture, applyGestureMove, applyDismissTransform, commitDismiss,
// animateDismiss; the numbers are the same in both versions). obsidian.d.ts does not expose this viewer, so
// the behaviour and numbers are repeated here. No Obsidian and no DOM: the viewer
// (src/assets/viewer/viewer.ts) supplies points, time and heights.

/** The finger moved down farther than this: the swipe has started, px. */
export const START_PX = 20;
/** …and down this many times more than sideways. */
export const START_RATIO = 1.5;
/**
 * Sideways farther than `START_PX` and this many times more than down: the touch went sideways and will not
 * become a swipe down.
 */
export const SIDE_RATIO = 2.5;
/** Released faster than this closes the viewer, px/ms… */
export const CLOSE_SPEED = 0.4;
/** …or dragged farther than this share of the image area height. */
export const CLOSE_SHARE = 0.33;
/** The backdrop and close button fade over this share of the window height… */
export const FADE_SPAN = 0.6;
/** …but not below this. */
export const FADE_MIN = 0.1;
/** A short drag returns in this time, ms. */
export const BACK_MS = 200;
/** Fly-away: `FLY_MS` from rest, faster when already dragged, but not faster than `FLY_MIN_MS`, ms. */
export const FLY_MS = 300;
export const FLY_MIN_MS = 80;
/** It flies to the window height plus this much, px. */
export const FLY_PAST_PX = 50;
/** Obsidian's viewer animation curve: `cubic-bezier(0.4, 0, 0.22, 1)`. */
export const EASING = [0.4, 0, 0.22, 1] as const;
/**
 * Bottom strip of a video where a touch goes to the player, not the swipe, px. The iOS player scrubber strip
 * (WebKit modern-media-controls: `--inline-controls-bar-height: 31px` at
 * `--inline-controls-inside-margin: 6px` above the bottom edge, `inline-media-controls.js` -> `layout`) is
 * the bottom 37 px; with a finger margin up to the iOS 44 pt touch target, which is also Obsidian's
 * `--touch-size-m`. Player buttons above the strip react to taps, not drags.
 */
export const VIDEO_BAR_PX = 44;

/** Swipe down starts: the finger moved `dy` down and `dx` sideways; `atFit`: the image is not zoomed. */
export function dismissStarts(dx: number, dy: number, atFit: boolean): boolean {
  return atFit && dy > START_PX && dy > START_RATIO * Math.abs(dx);
}

/**
 * A touch at height `y` started in the bottom strip of a video whose bottom edge is at `bottom`: it
 * belongs to the scrubber.
 */
export function inVideoBar(y: number, bottom: number): boolean {
  return y >= bottom - VIDEO_BAR_PX && y <= bottom;
}

/**
 * The touch went sideways: in Obsidian that is paging, and this touch will not become a swipe down. On a
 * video it is scrubbing, which does not close the viewer.
 */
export function goesSideways(dx: number, dy: number): boolean {
  const side = Math.abs(dx);
  return side > START_PX && side > SIDE_RATIO * Math.abs(dy);
}

/**
 * Released: close if the finger moved down faster than `CLOSE_SPEED` or farther than the share of
 * the image area height.
 */
export function dismissCloses(dy: number, speed: number, stageHeight: number): boolean {
  return speed > CLOSE_SPEED || dy > CLOSE_SHARE * stageHeight;
}

/**
 * Opacity of the backdrop and close button when the image is moved down by `offset` in a window
 * `windowHeight` tall.
 */
export function dismissFade(offset: number, windowHeight: number): number {
  if (windowHeight <= 0) return offset > 0 ? FADE_MIN : 1;
  return Math.max(FADE_MIN, 1 - offset / (FADE_SPAN * windowHeight));
}

/** Where the image flies to: the window height plus `FLY_PAST_PX`, px. */
export function flyTo(windowHeight: number): number {
  return windowHeight + FLY_PAST_PX;
}

/** How long an image already moved by `offset` takes to fly away, ms: the farther dragged, the faster. */
export function flyMs(offset: number, windowHeight: number): number {
  const left = Math.max(0, 1 - offset / flyTo(windowHeight));
  return Math.max(FLY_MIN_MS, Math.round(FLY_MS * left));
}

/**
 * The `EASING` curve at time fraction `p` (0…1): the distance fraction. Time is the Bezier x(s), distance is
 * y(s); s is found by bisection, since x(s) of such a curve is monotonic.
 */
export function ease(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const [x1, y1, x2, y2] = EASING;
  const at = (s: number, a: number, b: number): number =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (at(mid, x1, x2) < p) low = mid;
    else high = mid;
  }
  return at((low + high) / 2, y1, y2);
}

/** How a touch ended: `close` closes, `back` returns the image, `null` means there was no swipe. */
export type SwipeEnd = 'close' | 'back' | null;

type State = 'idle' | 'watch' | 'drag' | 'dead';

/**
 * One viewer touch: fingers, swipe start, speed and end. A second finger kills the swipe until the touch
 * ends, leaving room for pinch zoom; a partial drag returns.
 */
export class DismissSwipe {
  readonly #fingers = new Set<number>();
  #state: State = 'idle';
  #id = 0;
  #x0 = 0;
  #y0 = 0;
  #y = 0;
  #t = 0;
  #speed = 0;

  /** The swipe is running: the image follows the finger. */
  get dragging(): boolean {
    return this.#state === 'drag';
  }

  /** Fingers the touch holds: the viewer forgets fingers that are no longer on screen by cancelling them. */
  get fingers(): number[] {
    return [...this.#fingers];
  }

  /**
   * A finger touched down. `allowed` means a swipe is possible here: a touch outside the video
   * scrubber strip, and the image is not zoomed. A second finger kills the swipe: `back` means
   * return the partial drag.
   */
  down(id: number, x: number, y: number, t: number, allowed: boolean): 'back' | null {
    this.#fingers.add(id);
    if (this.#fingers.size > 1) {
      const was = this.#state;
      this.#state = 'dead';
      return was === 'drag' ? 'back' : null;
    }
    this.#state = allowed ? 'watch' : 'dead';
    this.#id = id;
    this.#x0 = x;
    this.#y0 = y;
    this.#y = y;
    this.#t = t;
    this.#speed = 0;
    return null;
  }

  /**
   * A finger moved: how far to move the image down, px; `null` means no swipe. Speed is
   * smoothed as in Obsidian.
   */
  move(id: number, x: number, y: number, t: number): number | null {
    if (id !== this.#id || (this.#state !== 'watch' && this.#state !== 'drag')) return null;
    const dx = x - this.#x0;
    const dy = y - this.#y0;
    if (this.#state === 'watch') {
      if (goesSideways(dx, dy)) this.#state = 'dead';
      else if (dismissStarts(dx, dy, true)) this.#state = 'drag';
      if (this.#state !== 'drag') return null;
    }
    const dt = t - this.#t;
    if (dt > 0) this.#speed = 0.5 * ((y - this.#y) / dt) + 0.5 * this.#speed;
    this.#y = y;
    this.#t = t;
    return Math.max(0, dy);
  }

  /**
   * Finger lifted at height `y`; the decision comes when the last one is lifted. `stageHeight` is
   * the image area height.
   */
  up(id: number, y: number, stageHeight: number): SwipeEnd {
    this.#fingers.delete(id);
    if (this.#fingers.size > 0) return null;
    const drag = this.#state === 'drag';
    this.#state = 'idle';
    if (!drag) return null;
    return dismissCloses(y - this.#y0, this.#speed, stageHeight) ? 'close' : 'back';
  }

  /** The browser cancelled the touch or the viewer forgot the finger: return the partial drag. */
  cancel(id: number): 'back' | null {
    this.#fingers.delete(id);
    if (this.#fingers.size > 0) return null;
    const drag = this.#state === 'drag';
    this.#state = 'idle';
    return drag ? 'back' : null;
  }

  /** Forget the touch: the viewer changed content or closed. */
  reset(): void {
    this.#fingers.clear();
    this.#state = 'idle';
  }
}
