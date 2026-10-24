// Grid gestures on a phone. A tap on a tile does what a double click does on desktop: a file opens full
// screen, a folder opens in the same grid. A long press opens Obsidian's file menu, as in Obsidian's mobile
// file explorer. The module sends tiles the events their owner modules already listen to: `dblclick` for the
// viewer (src/assets/viewer/open.ts) and folder navigation (src/assets/grid/view.ts), `contextmenu` for the
// menu (src/assets/actions/file-menu.ts); the selection module's own `click` selects the tile. iOS WebKit
// sends no mouse events on a hold, hence our own touch timer. On desktop the module listens to nothing.
import { Platform, type Plugin } from 'obsidian';
import type { BubaAssets } from '../api.ts';
import { onGridEvent } from '../grid/selection.ts';
import { LONG_PRESS_MS, LongPress } from '../../core/gestures/long-press.ts';
import './mobile.css';

export function registerMobile(plugin: Plugin, assets: BubaAssets): void {
  if (!Platform.isMobile) return;
  const press = new LongPress();
  /**
   * Our own menu events, tracked by reference: a foreign menu can be synthetic too, so `isTrusted` cannot
   * tell.
   */
  const own = new WeakSet<Event>();
  let timer = 0;
  const stop = (): void => {
    window.clearTimeout(timer);
    timer = 0;
  };
  plugin.register(stop);

  onGridEvent(plugin, assets, 'touchstart', (evt, { path }) => {
    const tile = tileOf(evt.target);
    if (path === null || !tile) {
      // Touch on empty grid space: a second finger ends the gesture; a new touch closes the late menu window.
      press.touchOutside(performance.now());
      stop();
      return;
    }
    for (const touch of Array.from(evt.changedTouches)) {
      const at = performance.now();
      const { clientX, clientY } = touch;
      press.start(clientX, clientY, at);
      stop();
      timer = window.setTimeout(() => {
        timer = 0;
        // The timer fired, so the time is up even if the page's coarsened clock lags by a fraction of a
        // millisecond.
        if (!press.due(Math.max(performance.now(), at + LONG_PRESS_MS)) || !tile.isConnected) return;
        const init = { bubbles: true, cancelable: true, button: 2, clientX, clientY };
        const menu = new MouseEvent('contextmenu', init);
        own.add(menu);
        tile.dispatchEvent(menu);
      }, LONG_PRESS_MS);
    }
  });
  onGridEvent(plugin, assets, 'touchmove', (evt) => {
    const [touch] = Array.from(evt.touches);
    if (evt.touches.length > 1 || !touch) press.cancel(performance.now());
    else press.move(touch.clientX, touch.clientY);
  });
  onGridEvent(plugin, assets, 'touchend', (evt) => {
    stop();
    // After a long press the release produces `mousedown` and `click`; cancelling `touchend` suppresses them.
    if (press.end(performance.now()) === 'long' && evt.cancelable) evt.preventDefault();
  });
  onGridEvent(plugin, assets, 'touchcancel', () => {
    press.cancel(performance.now());
    stop();
  });

  // One hold, one menu. A foreign menu over the grid comes from the browser (Android, WebKit after release)
  // or is a synthetic one from Obsidian. If it comes first, ours is not sent; if it comes after the hold menu
  // (finger down or shortly after release), it is cancelled before the tile menu, which listens on the same
  // document in the bubble phase. Menus outside the grid are untouched. A non-bubbling event never reaches
  // the tile menu (DOM Standard, dispatch), so it is not a hold menu: our timer keeps running and the hold is
  // not marked.
  plugin.registerDomEvent(
    document,
    'contextmenu',
    (evt) => {
      if (own.has(evt) || !evt.bubbles || !inGrid(evt.target)) return;
      stop();
      if (press.nativeMenu(performance.now())) return;
      evt.preventDefault();
      evt.stopImmediatePropagation();
    },
    { capture: true },
  );

  // A tap on a tile is the desktop double click: a file opens in the viewer, a folder opens in this grid.
  onGridEvent(plugin, assets, 'click', (evt, { path }) => {
    if (!press.click() || path === null) return;
    tileOf(evt.target)?.dispatchEvent(
      new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: evt.clientX,
        clientY: evt.clientY,
      }),
    );
  });
}

function tileOf(target: EventTarget | null): HTMLElement | null {
  const el = target as Element | null;
  return typeof el?.closest === 'function' ? el.closest<HTMLElement>('.buba-tile[data-path]') : null;
}

/** The target is inside the grid body, where `onGridEvent` hit testing starts (grid/selection.ts). */
function inGrid(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return typeof el?.closest === 'function' && el.closest('.buba-grid-scroller') !== null;
}
