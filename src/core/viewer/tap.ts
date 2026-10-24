// A single tap in the phone viewer hides and shows the viewer buttons (close, "Fit to screen", arrows), as
// iPhone Photos does: a tap hides the bars, the next one shows them. In Obsidian's image viewer a single tap
// does nothing (lightbox, app.js 1.13.7: `checkDoubleTap` knows only the double tap), so this is a
// deliberate departure from Obsidian. A tap is told from a double tap by a pause: it toggles only if no
// second tap came within `DOUBLE_TAP_MS`. The double tap uses the same numbers and touches as the pinch
// (pinch.ts, `TouchZoom.up`), so the buttons do not blink where a double tap zoomed. The machine only
// listens: it never starts or kills viewer gestures and never cancels browser actions. No Obsidian and no
// DOM: points in screen points and time come from the viewer (src/assets/viewer/viewer.ts), which also owns
// the pause timer and the button fade.
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, PAN_START_PX, TAP_SLOP_PX } from './pinch.ts';
import type { Point } from './zoom.ts';

/** A press longer than this, ms, is a long press, not a tap. */
export const TAP_HOLD_MS = 500;

/** Buttons fade out and in over this long, ms, with the `EASING` curve (swipe.ts), like the swipe return. */
export const CONTROLS_FADE_MS = 200;

/** Where and how the touch started, decided by the viewer. */
export interface TapStart {
  /** A touch on the stage with a loaded image or video, not on buttons, frames or the video scrubber. */
  stage: boolean;
  /** The image is zoomed: a finger pans it from `PAN_START_PX`, which is a pan (as in the pinch). */
  zoomed: boolean;
  /** Nothing was moving: a touch that stopped a zoom animation, momentum or swipe return does not toggle. */
  still: boolean;
}

interface Tap extends Point {
  t: number;
}

const apart = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Viewer taps: a single tap on the stage makes `up` return `'wait'`, and the viewer asks `due()` after
 * `DOUBLE_TAP_MS`. Any new touch cancels the wait: it is the second of a double tap or another gesture. A
 * touch with two fingers is a pinch, not a tap.
 */
export class TapToggle {
  readonly #fingers = new Set<number>();
  #start: Tap = { x: 0, y: 0, t: 0 };
  #from: TapStart = { stage: false, zoomed: false, still: false };
  /** The finger moved `TAP_SLOP_PX` or more from the start on an axis. */
  #moved = false;
  /** The finger moved `PAN_START_PX` or more from the start: a pan for a zoomed image. */
  #panned = false;
  #multi = false;
  /** The previous stage tap, the first of a possible double tap; like `TouchZoom.#tap`. */
  #tap: Tap | null = null;
  /** A single tap is waiting for the pause. */
  #pending = false;

  /** Fingers the touch holds: the viewer forgets those no longer on screen (as in the pinch). */
  get fingers(): number[] {
    return [...this.#fingers];
  }

  /** A finger touched down; a second finger makes the touch a pinch. */
  down(id: number, point: Point, t: number, from: TapStart): void {
    this.#pending = false;
    this.#fingers.add(id);
    if (this.#fingers.size > 1) {
      this.#multi = true;
      return;
    }
    this.#start = { x: point.x, y: point.y, t };
    this.#from = from;
    this.#moved = false;
    this.#panned = false;
    this.#multi = false;
  }

  move(id: number, point: Point): void {
    if (!this.#fingers.has(id) || this.#fingers.size > 1) return;
    this.#track(point);
    // A pinch starts panning a zoomed image only on move, not on release (`TouchZoom.move`).
    if (apart(point, this.#start) >= PAN_START_PX) this.#panned = true;
  }

  /** Finger lifted: `'wait'` means a single tap, ask `due()` after the pause; `null` otherwise. */
  up(id: number, point: Point, t: number): 'wait' | null {
    if (!this.#fingers.delete(id)) return null;
    if (this.#fingers.size > 0 || this.#multi) return null;
    this.#track(point);
    const from = this.#from;
    if (!from.stage || this.#moved || (from.zoomed && this.#panned)) return null;
    const tap = { x: point.x, y: point.y, t };
    const prev = this.#tap;
    if (prev && t - prev.t < DOUBLE_TAP_MS && apart(prev, tap) < DOUBLE_TAP_PX) {
      this.#tap = null;
      return null;
    }
    this.#tap = tap;
    if (!from.still || t - this.#start.t > TAP_HOLD_MS) return null;
    this.#pending = true;
    return 'wait';
  }

  /** The touch was cancelled or the finger forgotten: it will not become a tap. */
  cancel(id: number): void {
    if (!this.#fingers.delete(id)) return;
    this.#multi = this.#multi || this.#fingers.size > 0;
    this.#moved = true;
  }

  /** The pause has passed: `true` means there was no second tap, toggle the buttons (once). */
  due(): boolean {
    const due = this.#pending;
    this.#pending = false;
    return due;
  }

  /** Another file or the viewer closed: no wait and no previous tap. */
  reset(): void {
    this.#fingers.clear();
    this.#pending = false;
    this.#tap = null;
    this.#multi = false;
  }

  #track(point: Point): void {
    const dx = point.x - this.#start.x;
    const dy = point.y - this.#start.y;
    if (Math.abs(dx) >= TAP_SLOP_PX || Math.abs(dy) >= TAP_SLOP_PX) this.#moved = true;
  }
}
