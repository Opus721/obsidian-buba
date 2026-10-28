// Obsidian's bookmarks file, read through the vault adapter: `<config dir>/bookmarks.json`, written by the core
// plugin Bookmarks. The plugin API has no bookmarks and no event for their change, so `watchBookmarks` checks
// the file's modification time every few seconds and when the window gets focus; a read only follows a change.
import type { Plugin } from 'obsidian';
import { parseBookmarks, type Bookmark } from '../core/bookmarks/parse.ts';

/** How often the file's modification time is checked. */
const CHECK_MS = 3000;

/** Calls `changed` with the bookmarks at once and after each change of the file; stops on plugin unload. */
export function watchBookmarks(plugin: Plugin, changed: (items: Bookmark[]) => void): void {
  const { adapter, configDir } = plugin.app.vault;
  const path = `${configDir}/bookmarks.json`;
  let seen: number | null = null;
  let busy = false;
  const check = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const stat = await adapter.stat(path);
      const mtime = stat?.type === 'file' ? stat.mtime : 0;
      if (mtime === seen) return;
      seen = mtime;
      changed(mtime ? parseBookmarks(await adapter.read(path)) : []);
    } catch (error) {
      console.error('Buba: Obsidian bookmarks not read', error);
    } finally {
      busy = false;
    }
  };
  void check();
  plugin.registerInterval(window.setInterval(() => void check(), CHECK_MS));
  plugin.registerDomEvent(window, 'focus', () => void check());
}
