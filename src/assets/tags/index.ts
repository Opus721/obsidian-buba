// Entry point of the "Tags and panel" block, called by one line in `src/assets/index.ts`. Each part of the
// block (panel, rename, grid sources, sorting, keys) adds one registration call here.
import {
  addIcon,
  removeIcon,
  TFile,
  type Events,
  type Menu,
  type Plugin,
  type TAbstractFile,
} from 'obsidian';
import { t } from '../../core/i18n/dict/tags.ts';
import { MENU_SOURCE, TILE_MENU } from '../../core/layout/grid-events.ts';
import { inDataDir, type TagStorage } from '../../core/storage/types.ts';
import { ownTitle } from '../../platform/menu-title.ts';
import type { BubaAssets } from '../api.ts';
import { registerInspector } from '../inspector/index.ts';
import { registerCopyTags } from './copy.ts';
import { registerCommentMarks } from './comment-marks.ts';
import { openTagPicker } from './picker.ts';
import { registerRenameTag } from './rename.ts';
import { registerSelectionActions } from './selection.ts';
import { registerRatingSort } from './sort-rating.ts';
import { registerTagSources } from './sources.ts';
import { GROUP_ICON, GROUP_ICON_SVG, registerTagList } from './tag-list.ts';

export function registerTags(plugin: Plugin, assets: BubaAssets): void {
  // Tag group icon, before the "All tags" item that draws it; removed on plugin unload.
  addIcon(GROUP_ICON, GROUP_ICON_SVG);
  plugin.register(() => removeIcon(GROUP_ICON));
  registerInspector(plugin, assets);
  registerCommentMarks(plugin, assets, () => storageOf(plugin));
  const { workspace } = plugin.app;
  // Tile menu via the tile menu event, before `file-menu`, so "Add tag…" lands in the first group next to
  // "Move file to...". Subscribed after the file panel (`registerInspector` above) so "File panel" stays
  // first on phones. In other menus Obsidian calls `file-menu` for one file and `files-menu` for several
  // selected in the file explorer; the tile menu sends those too with source `buba-grid`, where the item is
  // already present.
  plugin.registerEvent(
    (workspace as Events).on(TILE_MENU, (...data: unknown[]) => {
      const [menu, files] = data as [Menu, unknown];
      if (Array.isArray(files)) addTagItem(plugin, menu, files as TAbstractFile[]);
    }),
  );
  plugin.registerEvent(
    workspace.on('file-menu', (menu, file, source) => {
      if (source !== MENU_SOURCE) addTagItem(plugin, menu, [file]);
    }),
  );
  plugin.registerEvent(
    workspace.on('files-menu', (menu, files, source) => {
      if (source !== MENU_SOURCE) addTagItem(plugin, menu, files);
    }),
  );
  // "Copy tags" and "Paste tags" follow "Add tag…" in the same section.
  registerCopyTags(plugin, assets, () => storageOf(plugin));
  registerRenameTag(plugin, () => storageOf(plugin));
  registerRatingSort(plugin, assets, () => storageOf(plugin));
  registerTagSources(plugin, assets, () => storageOf(plugin));
  registerTagList(plugin, assets, () => storageOf(plugin));
  registerSelectionActions(plugin, assets);
}

/**
 * Storage is the plugin's `storage` field; until it exists there is no menu item. The plugin sets it to the
 * `createStore` storage (src/platform/storage/index.ts), including tag declarations.
 */
function storageOf(plugin: Plugin): TagStorage | undefined {
  return (plugin as Plugin & { storage?: TagStorage }).storage;
}

/**
 * "Add tag…" item for a batch of files: folders and journals in Buba data folders (`__buba-data/`, the old
 * `Buba/`) are left out; no item for an empty batch. Section `action` puts it with "Rename" and "Make a
 * copy": Obsidian puts an item without a section at the end of the menu, below "Delete".
 */
function addTagItem(plugin: Plugin, menu: Menu, files: readonly TAbstractFile[]): void {
  const paths = files
    .filter((file) => file instanceof TFile && !inDataDir(file.path))
    .map((file) => file.path);
  if (!paths.length || !storageOf(plugin)) return;
  menu.addItem((item) =>
    item
      .setTitle(ownTitle(t('menuAddTag')))
      .setIcon('tag')
      .setSection('action')
      .onClick(() => {
        const storage = storageOf(plugin);
        if (storage) openTagPicker(plugin.app, storage, paths);
      }),
  );
}
