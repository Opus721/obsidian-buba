// The view-and-actions block plugs into the grid and tree with one line in src/assets/index.ts. Each feature
// is its own file with its own `(plugin, assets) => void` function, so features share no lines.
import type { Plugin } from 'obsidian';
import type { BubaAssets } from '../api.ts';
import { registerSelection } from '../grid/selection.ts';
import { registerViewerOpen } from '../viewer/open.ts';
import { registerFileMenu } from './file-menu.ts';
import { registerImportDrop } from './import-drop.ts';
import { registerImportPick } from './import-pick.ts';
import { registerMenuItems } from './menu-items.ts';
import { registerNoteDrop } from './note-drop.ts';
import { registerTileDrag } from './tile-drag.ts';
import { registerTreeDrop } from './tree-drop.ts';
import { registerUndo } from './undo.ts';

export function registerActions(plugin: Plugin, assets: BubaAssets): void {
  registerSelection(plugin, assets);
  registerFileMenu(plugin, assets);
  registerMenuItems(plugin, assets);
  registerViewerOpen(plugin, assets);
  registerTileDrag(plugin, assets);
  registerTreeDrop(plugin, assets);
  registerImportDrop(plugin, assets);
  registerImportPick(plugin, assets);
  registerNoteDrop(plugin, assets);
  registerUndo(plugin, assets);
}
