// Row menus for Buba lists and the tree ("All tags" in src/assets/tags/tag-list.ts, tree items in
// src/assets/tree/view.ts) and the thumbnails of the generation sections (src/generation/thumbs.ts): right
// click, or a long press on a phone. iOS WebKit sends no `contextmenu` on a
// hold, and Obsidian synthesizes one only for draggable rows (`onDragEnd`, Obsidian 1.13), so the timer is
// our own, on `LongPress` (0.5 s and 10 pt, as in UIKit). One listener serves all lists: rows a list draws
// itself attach per row; rows rebuilt wholesale are delegated from the container by selector. The row with an
// open menu is highlighted as in Obsidian's file explorer: with `Menu.setParentElement` Obsidian adds
// `has-active-menu` on show and removes it on close; an empty menu is not shown and leaves the row alone
// (Obsidian 1.14).
import { Platform, type Menu } from 'obsidian';
import { LONG_PRESS_MS, LongPress } from '../core/gestures/long-press.ts';

/**
 * Where to show a menu: the right-click event or the long-press point. `row` is the menu's row, highlighted
 * while the menu is open; a menu not opened from a row (a command) has none.
 */
export type MenuAt = ({ evt: MouseEvent } | { x: number; y: number }) & { row?: HTMLElement };

/** Row menu position: always has a row. */
export type RowMenuAt = MenuAt & { row: HTMLElement };

/** Shows the menu at `at`; a given row stays highlighted while the menu is open, as in the file explorer. */
export function showRowMenu(menu: Menu, at: MenuAt): Menu {
  if (at.row) menu.setParentElement(at.row);
  if ('evt' in at) menu.showAtMouseEvent(at.evt);
  else menu.showAtPosition({ x: at.x, y: at.y });
  return menu;
}

/**
 * Row menus of one list. There is one finger, so the touch state is shared by the list. A foreign menu during
 * a hold and shortly after it is cancelled (`nativeMenu`, as for tiles); a `click` after a long press or a
 * move is not a click. The timer runs in the row's window: the view may have moved to another Obsidian
 * window.
 *
 * If the row is removed under the finger (the tree rebuilt its folder rows), touch events keep going to the
 * target where the touch began and no longer bubble from the detached row to the container (MDN,
 * `Touch.target`), so no `touchend` arrives. Such a touch ends without a menu: the timer cancels it instead
 * of holding it, and the next touch on the container resets it, so it is not taken for a second finger and a
 * browser menu on a live row is not cancelled.
 */
export class RowMenus {
  readonly #press = new LongPress();
  #timer = 0;
  #win: Window | null = null;
  /** Row of the last touch. */
  #row: HTMLElement | null = null;

  /**
   * Attaches to the row `el`; with `selector`, to every `selector` row inside `el` by delegation: one
   * listener set per container, so rebuilt rows keep working. A click or touch outside rows gives no menu and
   * leaves the browser menu alone. `open` receives the menu position and the row.
   */
  attach(el: HTMLElement, open: (at: RowMenuAt) => void, selector?: string): void {
    const rowOf = (evt: Event): HTMLElement | null => {
      if (selector === undefined) return el;
      const row = (evt.target as Element | null)?.closest<HTMLElement>(selector) ?? null;
      return row && el.contains(row) ? row : null;
    };
    el.addEventListener('contextmenu', (evt) => {
      const row = rowOf(evt);
      if (!row) return;
      evt.preventDefault();
      if (Platform.isMobile && !this.#press.nativeMenu(performance.now())) return;
      this.stop();
      open({ evt, row });
    });
    if (!Platform.isMobile) return;
    el.addEventListener(
      'touchstart',
      (evt) => {
        if (this.#row && !this.#row.isConnected) this.#press.cancel(performance.now());
        const row = rowOf(evt);
        const [touch] = Array.from(evt.changedTouches);
        if (!row || !touch) return;
        const at = performance.now();
        const { clientX: x, clientY: y } = touch;
        this.#press.start(x, y, at);
        this.stop();
        this.#row = row;
        this.#win = row.win;
        this.#timer = this.#win.setTimeout(() => {
          this.#timer = 0;
          if (!row.isConnected) {
            this.#press.cancel(performance.now());
            return;
          }
          // The timer fired, so the time is up even if the page's coarsened clock lags by a fraction of a
          // millisecond. The extra 1 ms covers rounding: `(at + 500) - at` in floating point can be slightly
          // under 500.
          if (!this.#press.due(Math.max(performance.now(), at + LONG_PRESS_MS + 1))) return;
          open({ x, y, row });
        }, LONG_PRESS_MS);
      },
      { passive: true },
    );
    el.addEventListener(
      'touchmove',
      (evt) => {
        const [touch] = Array.from(evt.touches);
        if (evt.touches.length > 1 || !touch) this.#press.cancel(performance.now());
        else this.#press.move(touch.clientX, touch.clientY);
      },
      { passive: true },
    );
    el.addEventListener('touchend', (evt) => {
      this.stop();
      if (this.#press.end(performance.now()) === 'long' && evt.cancelable) evt.preventDefault();
    });
    el.addEventListener('touchcancel', () => {
      this.#press.cancel(performance.now());
      this.stop();
    });
  }

  /** A click on a row is a click unless it follows a long press or a finger move. */
  click(): boolean {
    return this.#press.click();
  }

  /** Clears the timer, on release and when the list is cleaned up. */
  stop(): void {
    if (this.#timer) this.#win?.clearTimeout(this.#timer);
    this.#timer = 0;
  }
}
