// Swipe from the right edge in the viewer on a phone: a touch near the right edge of the stage that moves
// left closes the viewer and slides in the "File panel" with this file from the right. Our own gesture: the
// viewer is a `Modal`, while Obsidian's drawer gesture listens only on the workspace area
// (`gM(workspace.containerEl, …)` in app.js 1.14.4), and the drawer is drawn below modals. The numbers are
// Obsidian's gestures (app.js 1.14.4): the edge zone is the phone Settings "back" gesture (farther than
// `40 + safe area inset` from the edge is not a gesture); the swipe recognizer `gM` (one touch; direction is
// sideways more than vertical; speed smoothed as `0.8 * old + 0.2 * new`; on release the distance plus speed
// `dx + 1000 * v`); the drawer (opens if that distance exceeds half its width, `i*h>m/2`, app.js 1.14.4 and
// 1.13.7; width `clamp(300px, 84vw, 450px)`, `100vw` on phones up to 380 px, app.css 1.13.7). obsidian.d.ts
// has none of these gestures, so the numbers are repeated here. No Obsidian and no DOM: the viewer
// (src/assets/viewer/viewer.ts) supplies points, time and screen width.
import { START_PX } from './swipe.ts';

/**
 * Workspace event: the viewer was closed by a right-edge swipe, show the file in the "File panel". Data is
 * the viewer's `TFile`. Sent by the viewer, received by the panel module; the name lives here in core because
 * modules do not import each other.
 */
export const FILE_PANEL = 'buba:file-panel';

/** The touch started no farther than this from the right edge of the stage, px. */
export const EDGE_PX = 40;
/** Speed smoothing: this share comes from the previous speed, the rest from the new movement. */
export const SPEED_KEEP = 0.8;
/** On release, the speed over this many ms is added to the distance. */
export const PROJECT_MS = 1000;
/**
 * Obsidian drawer width (app.css 1.13.7, `.workspace-drawer`): `--mobile-sidebar-width` is this share of the
 * screen width, no narrower than `--mobile-sidebar-min-width` and no wider than
 * `--mobile-sidebar-max-width`; on phones up to 380 px
 * (`@media (max-width: 380px) { .is-phone.is-mobile { … } }`) it is full screen. A theme or snippet that
 * changes these variables does not move the threshold: deliberately not taken into account.
 */
export const DRAWER_VW = 0.84;
export const DRAWER_MIN_PX = 300;
export const DRAWER_MAX_PX = 450;
export const PHONE_FULL_MAX_PX = 380;

/** Obsidian drawer width on a screen `screen` wide; `phone` means a phone, not a tablet. */
export function drawerWidth(screen: number, phone: boolean): number {
  if (phone && screen <= PHONE_FULL_MAX_PX) return screen;
  return Math.min(DRAWER_MAX_PX, Math.max(DRAWER_MIN_PX, DRAWER_VW * screen));
}

/**
 * Android system "Back" gesture strip at the screen edge: the system takes a touch in it (`pointercancel`)
 * and closes the viewer, which left the viewer only 10 px of the `EDGE_PX` zone. Measured on a Pixel 7
 * emulator, Android 16, gesture navigation, default sensitivity: 30 dp; 32 with a margin. On Android the edge
 * zone is wider by this strip.
 */
export const ANDROID_BACK_PX = 32;

/**
 * A touch at `x` is at the right edge of the stage, which is at `right`; `system` is the system gesture strip
 * at the edge (Android).
 */
export function atRightEdge(x: number, right: number, system = 0): boolean {
  return right - x <= EDGE_PX + system;
}

/**
 * The finger moved `dx`, `dy` from the start: the direction is decided once it moves farther than
 * `START_PX` (the swipe-down threshold) on either axis, like the swipe down and in the same move; finger
 * jitter does not decide it.
 */
export function edgeDecided(dx: number, dy: number): boolean {
  return Math.abs(dx) > START_PX || Math.abs(dy) > START_PX;
}

/**
 * A decided move is an edge gesture: left farther than `START_PX` and more sideways than vertical
 * (Obsidian's `x` direction). The swipe down (`dismissStarts`: down more than one and a half times sideways)
 * never runs together with it.
 */
export function edgeStarts(dx: number, dy: number): boolean {
  return -dx > START_PX && -dx > Math.abs(dy);
}

/**
 * Released: distance `dx` plus speed `speed` (px/ms) beyond half of a drawer `drawer` wide, to the
 * left, opens the panel.
 */
export function edgeOpens(dx: number, speed: number, drawer: number): boolean {
  return -(dx + PROJECT_MS * speed) > drawer / 2;
}

type State = 'idle' | 'watch' | 'drag' | 'dead';

/**
 * One viewer touch for the edge gesture: fingers, start at the edge, direction, sideways speed and release. A
 * second finger kills the gesture until the touch ends, as in Obsidian (`points`). The swipe down is separate
 * (`DismissSwipe`, swipe.ts): while the edge gesture runs, the viewer does not pass moves to it.
 */
export class EdgeSwipe {
  readonly #fingers = new Set<number>();
  #state: State = 'idle';
  #id = 0;
  #x0 = 0;
  #y0 = 0;
  #x = 0;
  #t = 0;
  #speed = 0;

  /** The edge gesture is running: the touch is its own. */
  get active(): boolean {
    return this.#state === 'drag';
  }

  /** Fingers the touch holds: the viewer forgets fingers that are no longer on screen by cancelling them. */
  get fingers(): number[] {
    return [...this.#fingers];
  }

  /**
   * A finger touched down. `edge` means the gesture is possible here: at the right edge, where the swipe
   * down is possible too.
   */
  down(id: number, x: number, y: number, t: number, edge: boolean): void {
    this.#fingers.add(id);
    if (this.#fingers.size > 1) {
      this.#state = 'dead';
      return;
    }
    this.#state = edge ? 'watch' : 'dead';
    this.#id = id;
    this.#x0 = x;
    this.#y0 = y;
    this.#x = x;
    this.#t = t;
    this.#speed = 0;
  }

  /**
   * A finger moved; `true` means the touch is an edge gesture: the viewer cancels the browser action and does
   * not pass the move to the swipe down.
   */
  move(id: number, x: number, y: number, t: number): boolean {
    if (id !== this.#id || (this.#state !== 'watch' && this.#state !== 'drag')) return false;
    const dt = t - this.#t;
    if (dt > 0) this.#speed = SPEED_KEEP * this.#speed + (1 - SPEED_KEEP) * ((x - this.#x) / dt);
    this.#x = x;
    this.#t = t;
    if (this.#state === 'watch') {
      const dx = x - this.#x0;
      const dy = y - this.#y0;
      if (!edgeDecided(dx, dy)) return false;
      this.#state = edgeStarts(dx, dy) ? 'drag' : 'dead';
    }
    return this.#state === 'drag';
  }

  /** Finger lifted at `x`; `drawer` is the drawer width (`drawerWidth`). `true` means open the panel. */
  up(id: number, x: number, drawer: number): boolean {
    this.#fingers.delete(id);
    const drag = this.#state === 'drag' && id === this.#id;
    if (this.#fingers.size === 0) this.#state = 'idle';
    else if (drag) this.#state = 'dead';
    return drag && edgeOpens(x - this.#x0, this.#speed, drawer);
  }

  /** The browser cancelled the touch or the viewer forgot the finger: no gesture. */
  cancel(id: number): void {
    this.#fingers.delete(id);
    if (this.#fingers.size === 0) this.#state = 'idle';
    else if (id === this.#id) this.#state = 'dead';
  }

  /** Forget the touch: the viewer changed content or closed. */
  reset(): void {
    this.#fingers.clear();
    this.#state = 'idle';
  }
}
