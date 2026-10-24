// Ctrl + wheel over the grid changes the tile size by one slider step, as in Eagle. Like Obsidian 1.14's
// image zoom (`handleWheelZoom`), the event is cancelled; the wheel rules are in
// src/core/layout/tile-size.ts. The listener is installed once per grid view on `layout-change` and removed
// with the view. It must not be passive: only then does `preventDefault` stop the scroll of the same event.
// Only the grid body counts, not the toolbar, tree or notes. The size goes through `setGridState`, like the
// slider, so the top anchor and the place view are kept.
import type { Plugin } from 'obsidian';
import {
  stepTileSize,
  TileWheel,
  WHEEL_MODIFIER_DEFAULT,
  type WheelModifier,
} from '../../core/layout/tile-size.ts';
import { normalizeGridViewState } from '../../core/layout/view-state.ts';
import type { BubaAssets } from '../api.ts';
import { GridView } from './view.ts';

/** Grid body: the scrollable area with the tiles (view.ts). */
const BODY = '.buba-grid-scroller';

/** `modifier` is the wheel modifier at event time; it has no setting, the default is Ctrl. */
export function registerTileWheel(
  plugin: Plugin,
  assets: BubaAssets,
  modifier: () => WheelModifier = () => WHEEL_MODIFIER_DEFAULT,
): void {
  const wired = new WeakSet<object>();
  const install = (): void => {
    for (const view of assets.gridViews()) {
      if (!(view instanceof GridView) || wired.has(view)) continue;
      wired.add(view);
      const wheel = new TileWheel();
      view.registerDomEvent(
        view.containerEl,
        'wheel',
        (evt) => {
          const target = evt.target as Element | null;
          if (typeof target?.closest !== 'function' || !target.closest(BODY)) return;
          const steps = wheel.take(evt, modifier());
          if (steps === null) return;
          evt.preventDefault();
          if (steps === 0) return;
          const { size } = normalizeGridViewState(view.getState());
          const next = stepTileSize(size, steps);
          if (next !== size) view.setGridState({ size: next });
        },
        { passive: false },
      );
    }
  };
  plugin.app.workspace.onLayoutReady(install);
  plugin.registerEvent(plugin.app.workspace.on('layout-change', install));
}
