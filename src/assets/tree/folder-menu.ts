// Folder row menu of the Buba tree: Obsidian's `Menu` on right-click, on a long press on a phone (the row
// listener is in src/platform/row-menus.ts); the row stays highlighted while the menu is open. Group
// order is as close to the intended layout as Obsidian allows: in a plugin-built menu groups appear in the
// order their section first appears (`Menu.sort()`, app.js 1.14.4). So first the Buba event
// `buba:folder-menu`, which puts the actions module's "Add files here…" (section `action-primary`) at the
// very top; then "New subfolder…" and "New folder beside…" in section `action`, where Obsidian also puts
// "Move folder to..." and "Bookmark..."; there is no bare "New folder" because Obsidian's creates inside.
// "Rename…" follows them in the same section, as Obsidian's file explorer puts "Rename..." among its actions.
// Then "Folder color…" and "Folder icon…" in section `view`, then the `file-menu` event with the folder,
// source and tree leaf: Obsidian's and modules' folder items, as in Obsidian's file explorer and on a folder
// tile in the grid. "Delete" goes last, in red, after `file-menu`, so it is the bottom item as in the file
// explorer and the tile menu; Obsidian adds neither "Rename" nor "Delete" to a plugin-built menu
// (folder-actions.ts). Plugins that color folders (Iconic, Notebook Navigator) add their items through the same
// event. Our items carry the "Buba" label (src/platform/menu-title.ts). "Folder color…" is the tag color
// window (src/assets/color/picker.ts): fixed top row, the device's recent colors, the vault's pinned ones;
// "Folder icon…" is the Lucide icon window (icon-picker.ts). The folder look is stored by path, taken from
// the Obsidian folder at pick time: if the folder is renamed while the window is open, the look goes to the
// new path. Without storage (journals failed to load) there are no look items.
import { Menu, Notice, type App, type TFolder, type WorkspaceLeaf } from 'obsidian';
import { newFolderParent, type NewFolderPlace } from '../../core/actions/new-folder.ts';
import type { ColorValue } from '../../core/color/value.ts';
import { FOLDER_MENU } from '../../core/layout/grid-events.ts';
import type { FolderLooks, TagStorage } from '../../core/storage/types.ts';
import { pinnedColorsOf } from '../../core/tags/group-plan.ts';
import { t } from '../../core/i18n/dict/tree.ts';
import { ownTitle } from '../../platform/menu-title.ts';
import { openColorPicker } from '../color/picker.ts';
import { showRowMenu, type RowMenuAt } from '../../platform/row-menus.ts';
import type { PassportReader } from '../actions/menu-items.ts';
import { deleteFolder, renameFolder } from './folder-actions.ts';
import { FolderIconModal } from './icon-picker.ts';

/** What the folder menu takes from storage: folder looks and the color window's pinned colors. */
export type FolderLookStorage = FolderLooks & Pick<TagStorage, 'pinnedColors' | 'setColorPinned'>;

/**
 * A storage write; on failure a `failed` notice, with details in the console under the English `log` line.
 */
async function write(run: () => Promise<void>, failed: string, log: string): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`Buba: ${log}`, error);
    new Notice(failed);
  }
}

/** Folder creation items: core decides the place; "beside" a root-level folder means the root. */
const NEW_FOLDER_ITEMS = [
  ['newSubfolderItem', 'inside', 'folder-symlink'],
  ['newFolderBesideItem', 'beside', 'folder-plus'],
] as const satisfies readonly (readonly [title: string, place: NewFolderPlace, icon: string])[];

/**
 * Folder row menu: the `buba:folder-menu` event, folder creation (`newFolder` opens the new folder name
 * dialog in the given folder) and "Rename…", look items, then `file-menu` with source `source` and leaf
 * `leaf`, then "Delete"; `passports` lets the delete name references of generations inside.
 */
export function showFolderMenu(
  app: App,
  storage: FolderLookStorage | undefined,
  folder: TFolder,
  at: RowMenuAt,
  source: string,
  leaf: WorkspaceLeaf,
  newFolder: (parent: string) => void,
  passports?: PassportReader,
): Menu {
  const menu = new Menu();
  app.workspace.trigger(FOLDER_MENU, menu, folder, source, leaf);
  for (const [title, place, icon] of NEW_FOLDER_ITEMS)
    menu.addItem((item) =>
      item
        .setSection('action')
        .setTitle(ownTitle(t(title)))
        .setIcon(icon)
        .onClick(() => newFolder(newFolderParent(folder.path, place))),
    );
  menu.addItem((item) =>
    item
      .setSection('action')
      .setTitle(ownTitle(t('renameFolderItem')))
      .setIcon('pencil')
      .onClick(() => renameFolder(app, folder)),
  );
  if (storage) {
    menu.addItem((item) =>
      item
        .setSection('view')
        .setTitle(ownTitle(t('folderColorItem')))
        .setIcon('palette')
        .onClick(() => pickColor(app, storage, folder)),
    );
    menu.addItem((item) =>
      item
        .setSection('view')
        .setTitle(ownTitle(t('folderIconItem')))
        .setIcon('shapes')
        .onClick(() => pickIcon(app, storage, folder)),
    );
  }
  app.workspace.trigger('file-menu', menu, folder, source, leaf);
  menu.addItem((item) =>
    item
      .setSection('danger')
      .setTitle(ownTitle(t('deleteFolderItem')))
      .setIcon('trash-2')
      .setWarning(true)
      .onClick(() => void deleteFolder(app, folder, passports)),
  );
  return showRowMenu(menu, at);
}

/** Color window: each pick is written at once and the window stays open; storage skips equal values. */
export function pickColor(app: App, storage: FolderLookStorage, folder: TFolder): void {
  openColorPicker(app, {
    title: t('folderColorTitle', { name: folder.name }),
    value: storage.folderLook(folder.path).color,
    pinned: pinnedColorsOf(storage),
    onPick: (value: ColorValue | null) =>
      void write(
        () => storage.setFolderColor(folder.path, value),
        t('folderColorFailed'),
        'folder color not saved',
      ),
  });
}

/** Icon window: a pick closes the window and writes the icon; "Folder (default)" writes `null`. */
export function pickIcon(app: App, storage: FolderLookStorage, folder: TFolder): void {
  new FolderIconModal(app, storage.folderLook(folder.path).icon, (icon) => {
    void write(
      () => storage.setFolderIcon(folder.path, icon),
      t('folderIconFailed'),
      'folder icon not saved',
    );
  }).open();
}
