// One touch on a tile or row on a phone: a tap, a long press or nothing (move, second finger, cancel). No
// Obsidian or DOM: the grid (src/assets/mobile/index.ts) and row menus (src/platform/row-menus.ts) feed times and
// points. Thresholds as in UIKit's `UILongPressGestureRecognizer`: 0.5 s and
// 10 pt.

/** Hold time without movement that makes a long press, ms. */
export const LONG_PRESS_MS = 500;
/** Finger movement beyond this is neither a tap nor a long press, px. */
export const MOVE_SLOP_PX = 10;
/**
 * A foreign menu arriving within this time after a hold with a menu was released is a late duplicate of that
 * hold, ms. WebKit sends late mouse events up to 350 ms after `touchend`; a second menu was observed about a
 * second after the first. The next touch, on a tile or on empty grid space (`touchOutside`), closes the
 * window earlier.
 */
export const LATE_MENU_MS = 1500;

/** How a touch ended: `long` after a long press, `tap` a tap, `none` a move, second finger or cancel. */
export type PressEnd = 'tap' | 'long' | 'none';

type State = 'idle' | 'pressing' | 'held' | 'dead';

export class LongPress {
  #state: State = 'idle';
  #x = 0;
  #y = 0;
  #t = 0;
  /** How the last touch ended, for the `click` the browser sends after release. */
  #last: PressEnd | null = null;
  /** Until this time a foreign menu is a late duplicate of the released hold's menu. */
  #lateUntil = -Infinity;

  /** A finger touched down; a touch while one is down is a second finger: neither tap nor long press. */
  start(x: number, y: number, t: number): void {
    if (this.#state === 'pressing') this.#state = 'dead';
    if (this.#state !== 'idle') return;
    this.#state = 'pressing';
    this.#x = x;
    this.#y = y;
    this.#t = t;
    this.#last = null;
    this.#lateUntil = -Infinity;
  }

  move(x: number, y: number): void {
    if (this.#state === 'pressing' && Math.hypot(x - this.#x, y - this.#y) > MOVE_SLOP_PX)
      this.#state = 'dead';
  }

  /** The touch was cancelled by the browser (`touchcancel`) or by a second finger outside a tile. */
  cancel(t: number): void {
    if (this.#state === 'idle') return;
    this.#release(t, this.#state === 'held' ? 'long' : 'none');
  }

  /**
   * Touch on empty grid space. With a finger on a tile this is a second finger: the gesture ends, like
   * `cancel`, and the window after a shown menu stays. With no finger down it is a new touch: the late menu
   * window closes, as on a tile touch.
   */
  touchOutside(t: number): void {
    if (this.#state === 'idle') this.#lateUntil = -Infinity;
    else this.cancel(t);
  }

  /** Timer deadline: whether to show the menu now; true exactly once per touch. */
  due(t: number): boolean {
    if (this.#state !== 'pressing' || t - this.#t < LONG_PRESS_MS) return false;
    this.#state = 'held';
    return true;
  }

  /** The finger lifted. `long`: the menu is shown, so the release mouse events must be suppressed. */
  end(t: number): PressEnd {
    if (this.#state === 'idle') return 'none';
    const end: PressEnd =
      this.#state === 'held'
        ? 'long'
        : this.#state === 'pressing' && t - this.#t < LONG_PRESS_MS
          ? 'tap'
          : 'none';
    this.#release(t, end);
    return end;
  }

  /**
   * A menu not sent by this module: from the browser (Android, WebKit) or Obsidian itself. True lets it
   * through if this hold has not shown a menu yet; false if it has, with the finger down or released less
   * than `LATE_MENU_MS` ago.
   */
  nativeMenu(t: number): boolean {
    if (this.#state === 'held') return false;
    if (this.#state === 'idle') return t >= this.#lateUntil;
    if (this.#state === 'pressing') this.#state = 'held';
    return true;
  }

  /** `click` opens after a tap or a mouse click; after a long press or a move it is suppressed once. */
  click(): boolean {
    const last = this.#last;
    this.#last = null;
    return last !== 'long' && last !== 'none';
  }

  /** The finger lifted or the touch was cancelled; after a menu, opens the late foreign menu window. */
  #release(t: number, end: PressEnd): void {
    this.#lateUntil = this.#state === 'held' ? t + LATE_MENU_MS : -Infinity;
    this.#state = 'idle';
    this.#last = end;
  }
}
