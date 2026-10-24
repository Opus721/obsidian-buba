// Right-click on a tile opens Obsidian's regular file menu for the selection: a tile outside the selection
// gets selected alone; one file triggers `file-menu`, several trigger `files-menu`, with source `buba-grid`
// and the grid leaf. Obsidian and modules add items through the same event, as in the file explorer menu
// (https://docs.obsidian.md/Reference/TypeScript+API/Workspace/on('file-menu') ). Obsidian does not define
// the group order of a plugin-built menu: sections appear in the order first met (`Menu.sort()`, app.js of
// Obsidian 1.14.4), and Obsidian subscribes to `file-menu` before plugins do. Items that belong at the top
// are added by Buba modules through the `buba:tile-menu` event, before `file-menu`.
import { Menu, type Plugin, type TAbstractFile } from 'obsidian';
import { MENU_SOURCE, TILE_MENU } from '../../core/layout/grid-events.ts';
import type { BubaAssets } from '../api.ts';
import { onGridEvent, selectedFor } from '../grid/selection.ts';

/**
 * The tile menu source and the tile menu event fired before `file-menu` (menu, tile
 * files, source, grid leaf); the names live in core (src/core/layout/grid-events.ts),
 * and the actions module items and the panel module take them from here.
 */
export { MENU_SOURCE, TILE_MENU };

export function registerFileMenu(plugin: Plugin, assets: BubaAssets): void {
  const { vault, workspace } = plugin.app;
  onGridEvent(plugin, assets, 'contextmenu', (evt, { view, path }) => {
    if (path === null) return;
    evt.preventDefault();
    const files = selectedFor(view, path)
      .map((each) => vault.getAbstractFileByPath(each))
      .filter((file): file is TAbstractFile => file !== null);
    const [first] = files;
    if (!first) return;
    const menu = new Menu();
    workspace.trigger(TILE_MENU, menu, files, MENU_SOURCE, view.leaf);
    if (files.length === 1) workspace.trigger('file-menu', menu, first, MENU_SOURCE, view.leaf);
    else workspace.trigger('files-menu', menu, files, MENU_SOURCE, view.leaf);
    menu.showAtMouseEvent(evt);
  });
}
