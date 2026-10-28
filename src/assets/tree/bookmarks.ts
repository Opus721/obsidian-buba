// "Bookmarks" at the top of Buba's tree: Obsidian's own bookmarks, as Notion's "Favorites" above its pages
// (word of the owner 27.10 21:59; the order of the tree's sections agreed with the databases module: bookmarks,
// databases, tags, folders). They are added and removed with Obsidian's own "Bookmark…" (in the tile menu too)
// and kept by its core plugin, so they sync and stay in Obsidian's Bookmarks pane. The item is one row, without
// a list under it: a press opens the bookmarks in the Buba grid as a folder, bookmarked folders as folder tiles
// first, then the files, with sorting, filter and tile size, images and video in Buba's viewer (word of the
// owner 28.10 08:30). The item is in the tree only while there is a bookmark.
import type { Plugin } from 'obsidian';
import { bookmarkedPaths } from '../../core/bookmarks/parse.ts';
import { t } from '../../core/i18n/dict/tree.ts';
import { watchBookmarks } from '../../platform/bookmarks.ts';
import type { BubaAssets } from '../api.ts';

/** Place of "Bookmarks" among the tree's items: the very top. */
const ORDER = 10;

const SOURCE = { kind: 'bookmarks' } as const;

export function registerBookmarks(plugin: Plugin, assets: BubaAssets): void {
  const { vault } = plugin.app;
  let marked: { files: string[]; folders: string[] } = { files: [], folders: [] };
  const listeners = new Set<() => void>();
  // Bookmarks of files and folders that are gone (renamed outside Obsidian) are not counted or shown.
  const files = () => marked.files.filter((path) => vault.getFileByPath(path) !== null);
  const folders = () => marked.folders.filter((path) => vault.getFolderByPath(path) !== null);
  plugin.register(
    assets.registerGridSource(SOURCE.kind, {
      title: () => t('bookmarks'),
      paths: files,
      folders,
      onChange(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      empty: () => [t('noBookmarks')],
    }),
  );
  let remove: (() => void) | null = null;
  watchBookmarks(plugin, (items) => {
    marked = bookmarkedPaths(items);
    for (const listener of [...listeners]) listener();
    // A change re-registers the item: the tree redraws its row with the new count.
    remove?.();
    remove = null;
    if (marked.files.length + marked.folders.length === 0) return;
    remove = assets.registerTreeItem({
      id: 'bookmarks',
      title: t('bookmarks'),
      icon: 'lucide-bookmark',
      order: ORDER,
      source: SOURCE,
      count: () => files().length + folders().length,
    });
  });
  plugin.register(() => remove?.());
}
