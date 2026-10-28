// Copy and paste of tiles, as in Explorer: Ctrl+C (Cmd+C) in a grid with a selection, or "Copy" in the tile
// menu, remembers the selected files and folders; Ctrl+V, or "Paste" in the menu of the grid's empty space,
// copies them into the folder the grid shows, under free names ("name 1.png" when the name is taken, as "Make
// a copy"). Copies go through `vault.copy` (files and folders, Obsidian 1.8.7+); the originals stay, and the
// pasted copies are one undo step (Ctrl+Z puts them into the trash). Buba's
// own clipboard, one for all windows: the system clipboard keeps what the user copied elsewhere, and other
// apps cannot paste vault paths anyway. A folder is not pasted into itself or below itself. The empty-space
// menu also has "New folder…" and the module items of `buba:grid-menu` ("Add files…"). Keys go on the grid
// view's `scope`, by `code` so a Russian layout works too; in a text field, or with grid keys off, they go
// on to Obsidian. "New note", "New canvas" and "New base" come first in it (new-file.ts).
import {
  ItemView,
  Keymap,
  Menu,
  Notice,
  TFolder,
  type App,
  type Events,
  type Plugin,
  type TAbstractFile,
} from 'obsidian';
import { availablePath } from '../../core/actions/import-names.ts';
import { ROOT } from '../../core/actions/new-folder.ts';
import { t } from '../../core/i18n/dict/actions.ts';
import { GRID_MENU, TILE_MENU } from '../../core/layout/grid-events.ts';
import { normalizeGridViewState } from '../../core/layout/view-state.ts';
import { isTypingTarget } from '../../core/tags/keys.ts';
import { inBatch } from '../../platform/files/batch.ts';
import { recordCreated } from '../../platform/files/undo.ts';
import { ownTitle } from '../../platform/menu-title.ts';
import { settingsOf } from '../../platform/settings.ts';
import type { BubaAssets } from '../api.ts';
import { onGridEvent, type GridLeafView } from '../grid/selection.ts';
import { openNewFolder } from '../tree/create-folder.ts';
import { addNewFileItems } from './new-file.ts';

/** Vault paths of the last copied tiles. */
let copied: readonly string[] = [];

/** Remembers `paths` for the next paste. */
export function copyTiles(paths: readonly string[]): void {
  if (!paths.length) return;
  copied = [...paths];
  new Notice(t('tilesCopied', { count: paths.length }));
}

/** The folder a grid shows: a vault folder or the root; "All files" and module sources have none. */
export function shownFolder(view: GridLeafView): string | null {
  const state = normalizeGridViewState(view.getState());
  return state.source ? null : state.folder;
}

/** A free path for a copy of `file` in `folder`; a folder keeps its whole name, dots included. */
function freePath(folder: string, file: TAbstractFile, taken: (path: string) => boolean): string {
  if (!(file instanceof TFolder)) return availablePath(folder, file.name, taken);
  const inFolder = (name: string) => (folder === ROOT ? name : `${folder}/${name}`);
  let path = inFolder(file.name);
  for (let n = 1; taken(path); n += 1) path = inFolder(`${file.name} ${n}`);
  return path;
}

/** Whether `folder` is `file` itself or lies inside it. */
const inside = (folder: string, file: TAbstractFile): boolean =>
  file instanceof TFolder && (folder === file.path || folder.startsWith(`${file.path}/`));

/**
 * Copies `files` into `folder` under free names, one at a time; names are compared without case, as Windows
 * disks do. The copies are one undo step. Returns how many were copied.
 */
export async function copyInto(app: App, files: readonly TAbstractFile[], folder: string): Promise<number> {
  const target = folder === ROOT ? app.vault.getRoot() : app.vault.getFolderByPath(folder);
  if (!target) return 0;
  const taken = new Set(target.children.map((child) => child.path.toLowerCase()));
  const fit = files.filter((file) => !inside(folder, file));
  const made: string[] = [];
  const failed: string[] = [];
  await inBatch(fit.length, async () => {
    for (const file of fit) {
      const to = freePath(folder, file, (path) => taken.has(path.toLowerCase()));
      taken.add(to.toLowerCase());
      try {
        made.push((await app.vault.copy(file, to)).path);
      } catch (error) {
        console.error('Buba: copy not created', file.path, error);
        failed.push(file.name);
      }
    }
  });
  recordCreated(app, 'copy', folder === ROOT ? app.vault.getName() : folder, made);
  if (failed.length) new Notice(t('pasteFailed', { failed: failed.length, count: fit.length }));
  return made.length;
}

/** Pastes the copied tiles into `folder`; tiles deleted since are skipped. */
export async function pasteInto(app: App, folder: string): Promise<void> {
  const files = copied
    .map((path) => app.vault.getAbstractFileByPath(path))
    .filter((file): file is TAbstractFile => file !== null);
  if (!files.length) return;
  const done = await copyInto(app, files, folder);
  if (done)
    new Notice(t('tilesPasted', { folder: folder === ROOT ? app.vault.getName() : folder, count: done }));
}

export function registerClipboard(plugin: Plugin, assets: BubaAssets): void {
  const { app } = plugin;
  const { workspace } = app;
  const grids = (): GridLeafView[] =>
    assets.gridViews().filter((view): view is GridLeafView => view instanceof ItemView);
  const selected = (view: GridLeafView): string[] => view.selectedPaths?.() ?? [];

  // "Copy" for the tiles of the menu, in the group of "Make a copy".
  plugin.registerEvent(
    (workspace as Events).on(TILE_MENU, (...data: unknown[]) => {
      const [menu, files] = data as [Menu, unknown];
      if (!Array.isArray(files) || !files.length) return;
      const paths = (files as TAbstractFile[]).map((file) => file.path);
      menu.addItem((item) =>
        item
          .setTitle(ownTitle(t('copyItem')))
          .setIcon('clipboard-copy')
          .setSection('buba-file')
          .onClick(() => copyTiles(paths)),
      );
    }),
  );

  // The menu of the grid's empty space: new note, canvas and base, "New folder…" and "Paste" where the grid
  // shows a folder, then the module items ("Add files…").
  onGridEvent(plugin, assets, 'contextmenu', (evt, { view, path }) => {
    if (path !== null) return;
    evt.preventDefault();
    const folder = shownFolder(view);
    const menu = new Menu();
    if (folder !== null) {
      addNewFileItems(menu, app, folder, 'action');
      menu.addItem((item) =>
        item
          .setSection('action')
          .setTitle(ownTitle(t('newFolderItem')))
          .setIcon('folder-plus')
          .onClick(() => openNewFolder(app, folder, () => {})),
      );
      if (copied.length)
        menu.addItem((item) =>
          item
            .setSection('action')
            .setTitle(ownTitle(t('pasteItem')))
            .setIcon('clipboard-paste')
            .onClick(() => void pasteInto(app, folder)),
        );
    }
    workspace.trigger(GRID_MENU, menu, view);
    menu.showAtMouseEvent(evt);
  });

  // Ctrl+C and Ctrl+V on the scope of every grid view, once per view, like Ctrl+A (grid/selection.ts).
  const wired = new WeakSet<GridLeafView>();
  const wire = (): void => {
    for (const view of grids()) {
      const { scope } = view;
      if (!scope || wired.has(view)) continue;
      wired.add(view);
      const handler = scope.register(null, null, (evt) => {
        const key = evt.code === 'KeyC' ? 'copy' : evt.code === 'KeyV' ? 'paste' : null;
        if (
          key === null ||
          !Keymap.isModifier(evt, 'Mod') ||
          evt.shiftKey ||
          evt.altKey ||
          evt.isComposing ||
          !settingsOf(plugin).gridKeys ||
          isTypingTarget(evt.target as Element | null)
        )
          return undefined;
        if (evt.repeat) return false;
        const folder = shownFolder(view);
        if (key === 'copy') copyTiles(selected(view));
        else if (folder !== null) void pasteInto(app, folder);
        return false;
      });
      view.register(() => scope.unregister(handler));
    }
  };
  workspace.onLayoutReady(wire);
  plugin.registerEvent(workspace.on('layout-change', wire));

  const active = (): GridLeafView | undefined => {
    const view = workspace.getActiveViewOfType(ItemView);
    return grids().find((each) => each === view);
  };
  plugin.addCommand({
    id: 'copy-files',
    name: t('commandCopyTiles'),
    icon: 'clipboard-copy',
    checkCallback: (checking) => {
      const view = active();
      const paths = view ? selected(view) : [];
      if (!paths.length) return false;
      if (!checking) copyTiles(paths);
      return true;
    },
  });
  plugin.addCommand({
    id: 'paste-files',
    name: t('commandPasteTiles'),
    icon: 'clipboard-paste',
    checkCallback: (checking) => {
      const view = active();
      const folder = view ? shownFolder(view) : null;
      if (folder === null || !copied.length) return false;
      if (!checking) void pasteInto(app, folder);
      return true;
    },
  });
}
