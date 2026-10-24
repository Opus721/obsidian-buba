// "Copy tags" and "Paste tags": file menu items and commands. As in Eagle: right-click → "Copy Tags", then
// "Paste Tags" on other files. The file menu comes from Obsidian's `file-menu` and `files-menu` events:
// right-click on a tile (src/assets/actions/file-menu.ts), the file explorer, a file's "⋯"; on phones a long
// press on a tile opens the same menu. Items go in the `action` section next to "Add tag…", "Rename" and
// "Make a copy". Commands act on the active grid's selection and have no default hotkeys (users assign them
// in Obsidian's Hotkeys); without an active grid the command check returns `false`, so the same key in a note
// goes to the editor. What is copied and what paste sets: src/core/tags/copy.ts. Copied tags stay in memory
// until plugin unload, i.e. until Obsidian restarts; the system clipboard is untouched, so Ctrl+V in a note
// pastes text as before.
import { ItemView, Notice, TFile, type Events, type Menu, type Plugin, type TAbstractFile } from 'obsidian';
import { t } from '../../core/i18n/dict/tags.ts';
import { MENU_SOURCE, TILE_MENU } from '../../core/layout/grid-events.ts';
import { inDataDir, type TagStorage } from '../../core/storage/types.ts';
import { copyNotice, copyTags, pasteNotice, planPaste, type CopiedTags } from '../../core/tags/copy.ts';
import { ownTitle } from '../../platform/menu-title.ts';
import type { BubaAssets } from '../api.ts';
import { assignmentNotice } from './assignment-notice.ts';

export function registerCopyTags(
  plugin: Plugin,
  assets: BubaAssets,
  storageOf: () => TagStorage | undefined,
): void {
  const { vault, workspace } = plugin.app;
  let copied: CopiedTags | null = null;

  const copy = (storage: TagStorage, path: string): void => {
    const next = copyTags(storage, path);
    if (!next) return;
    copied = next;
    new Notice(copyNotice(next.tags));
  };

  // One storage write; a paste that changes nothing does not write and only shows the notice.
  const paste = async (storage: TagStorage, paths: string[]): Promise<void> => {
    if (!copied) return;
    const plan = planPaste(storage, copied, paths);
    const explain = assignmentNotice(plugin.app, storage, paths);
    if (plan.changed) {
      try {
        await storage.addTags(paths, plan.tags);
      } catch (error) {
        console.error('Buba: tags not pasted', error);
        new Notice(t('pasteFailed'));
        return;
      }
    }
    const explanation = explain();
    new Notice(
      pasteNotice(plan) + explanation,
      explanation || plan.swaps.length || plan.skipped.length ? 10_000 : undefined,
    );
  };

  // Folders and journals in Buba data folders (`__buba-data/`, the old `Buba/`) are not taggable files, as
  // for "Add tag…".
  const menuPaths = (files: readonly TAbstractFile[]): string[] =>
    files.filter((file) => file instanceof TFile && !inDataDir(file.path)).map((file) => file.path);

  const addItems = (menu: Menu, files: readonly TAbstractFile[]): void => {
    const storage = storageOf();
    const paths = menuPaths(files);
    if (!storage || !paths.length) return;
    const [single] = paths;
    if (paths.length === 1 && single !== undefined && storage.get(single).tags.length)
      menu.addItem((item) =>
        item
          .setTitle(ownTitle(t('menuCopyTags')))
          .setIcon('clipboard-copy')
          .setSection('action')
          .onClick(() => {
            const now = storageOf();
            if (now) copy(now, single);
          }),
      );
    if (copied)
      menu.addItem((item) =>
        item
          .setTitle(ownTitle(t('menuPasteTags')))
          .setIcon('clipboard-paste')
          .setSection('action')
          .onClick(() => {
            const now = storageOf();
            if (now) void paste(now, paths);
          }),
      );
  };
  // Tile menu via the tile menu event, before `file-menu` and right after "Add tag…"; `file-menu` and
  // `files-menu` with source `buba-grid` do not repeat the items.
  plugin.registerEvent(
    (workspace as Events).on(TILE_MENU, (...data: unknown[]) => {
      const [menu, files] = data as [Menu, unknown];
      if (Array.isArray(files)) addItems(menu, files as TAbstractFile[]);
    }),
  );
  plugin.registerEvent(
    workspace.on('file-menu', (menu, file, source) => {
      if (source !== MENU_SOURCE) addItems(menu, [file]);
    }),
  );
  plugin.registerEvent(
    workspace.on('files-menu', (menu, files, source) => {
      if (source !== MENU_SOURCE) addItems(menu, files);
    }),
  );

  // Selected files of the active grid, as for the selection commands (selection.ts): folders and Buba
  // journals do not count.
  const selected = (): string[] => {
    const active: unknown = workspace.getActiveViewOfType(ItemView);
    const view = assets.gridViews().find((each) => (each as unknown) === active);
    return (view?.selectedPaths?.() ?? []).filter(
      (path) => !inDataDir(path) && vault.getFileByPath(path) !== null,
    );
  };
  plugin.addCommand({
    id: 'copy-tags',
    name: t('commandCopyTags'),
    checkCallback: (checking) => {
      const storage = storageOf();
      const paths = selected();
      const [path] = paths;
      if (!storage || paths.length !== 1 || path === undefined || !storage.get(path).tags.length)
        return false;
      if (!checking) copy(storage, path);
      return true;
    },
  });
  plugin.addCommand({
    id: 'paste-tags',
    name: t('commandPasteTags'),
    checkCallback: (checking) => {
      const storage = storageOf();
      const paths = selected();
      if (!storage || !paths.length || !copied) return false;
      if (!checking) void paste(storage, paths);
      return true;
    },
  });
}
