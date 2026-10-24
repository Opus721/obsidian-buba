// Grid content sources: folder and "All files", on top of the file index. Paths come unordered: the grid
// sorts them and adds subfolder tiles itself.
import { Platform, type Plugin } from 'obsidian';
import { t } from '../../core/i18n/dict/grid.ts';
import { nameOf, ROOT } from '../../platform/files/file-index.ts';
import { vaultFileIndex } from '../../platform/files/vault-index.ts';
import type { BubaAssets, FolderSource } from '../api.ts';
import { placeViewsOf } from './place-views.ts';
import { renamesOf } from './view.ts';

export function registerGridSources(plugin: Plugin, assets: BubaAssets): void {
  const index = vaultFileIndex(plugin);
  // Folder renames are tracked from load, like the index: a deferred grid tab builds its view after them
  // (view.ts).
  renamesOf(plugin);
  // Place views are tracked from load: a view follows a renamed folder even with the grid closed, and the
  // first run reads the tabs once Obsidian has laid out the window (place-views.ts).
  placeViewsOf(plugin, assets);
  const onChange = (listener: () => void) => index.onChange(listener);
  plugin.register(
    assets.registerGridSource('folder', {
      title(source) {
        const { path } = source as FolderSource;
        return path === ROOT ? plugin.app.vault.getName() : nameOf(path);
      },
      paths(source) {
        const { path, withSubfolders } = source as FolderSource;
        return index.filesIn(path, withSubfolders).map((record) => record.path);
      },
      onChange,
      // Empty folder hint. A phone has neither drop from disk nor the top icon ("Add …" lives in the "More"
      // menu there), so only the first line. A deleted open folder gets no hint; the root always exists.
      empty(source) {
        const { path } = source as FolderSource;
        if (path !== ROOT && !plugin.app.vault.getFolderByPath(path)) return [];
        return Platform.isPhone ? [t('folderEmpty')] : [t('folderEmpty'), t('folderEmptyHint')];
      },
    }),
  );
  plugin.register(
    assets.registerGridSource('all', {
      title: () => t('allFiles'),
      paths: () => index.allFiles().map((record) => record.path),
      onChange,
    }),
  );
}
