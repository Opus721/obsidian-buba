// "Rename…" and "Delete" of a folder in the Buba tree: Obsidian adds them only to the menu of its
// own file explorer, not to a plugin-built one, so the tree adds them itself, the way the grid adds them for
// a tile (src/assets/actions/menu-items.ts). Rename uses the new folder name dialog and its name rule
// (create-folder.ts, src/core/actions/new-folder.ts) and `fileManager.renameFile` with an undo step, so links
// to the files inside stay intact and Ctrl+Z in the grid brings the old name back; the tree's expanded state,
// the folder look and an open grid follow the new path. Delete is Obsidian's own confirmation,
// `fileManager.promptForDeletion`, as in its file explorer: it names the folder, follows the "Confirm file
// deletion" and "Deleted files" settings. If files inside are references of generations, Buba's reference
// dialog names them first, as for a tile, and the folder goes with `trashFile` by the same "Deleted files"
// setting; the paths are marked as Buba's own deletes, so the generation module stays quiet about them. A grid
// tab on the deleted folder or inside it then shows the folder it was in, as Eagle does; a folder deleted
// elsewhere leaves its tab where it was (src/assets/grid/view.ts). Several folders picked in the tree go after
// one batch confirmation with their count (`deleteFolders`). A deletion is an undo step, as for files: Ctrl+Z
// brings the folders back from Obsidian's trash (src/platform/files/undo.ts).
import { Notice, TFile, TFolder, type App, type TAbstractFile } from 'obsidian';
import { renameFolderTarget } from '../../core/actions/new-folder.ts';
import { deleteGridFolder, GRID_VIEW_TYPE, normalizeGridViewState } from '../../core/layout/view-state.ts';
import { t } from '../../core/i18n/dict/tree.ts';
import { coreSetting } from '../../platform/core-settings.ts';
import { deleteRecorded, renameRecorded, viaPrompt, viaTrashFile } from '../../platform/files/undo.ts';
import {
  confirmDeleteFolder,
  confirmDeleteFolders,
  referencesOf,
  type PassportReader,
} from '../actions/menu-items.ts';
import { NameModal } from '../tags/group-modals.ts';

/** The name dialog with the current name selected; a refusal shows a notice and the dialog stays. */
export function renameFolder(app: App, folder: TFolder): void {
  new NameModal(
    app,
    t('renameFolderTitle', { name: folder.name }),
    folder.name,
    t('renameButton'),
    (text) => {
      const others = (folder.parent?.children ?? []).filter((child) => child !== folder);
      const target = renameFolderTarget(
        folder.path,
        text,
        others.map((child) => child.name),
      );
      if (!target.ok) {
        new Notice(target.why);
        return false;
      }
      if (target.path !== folder.path) void rename(app, folder, target.path);
      return true;
    },
    t('name'),
  ).open();
}

async function rename(app: App, folder: TFolder, to: string): Promise<void> {
  const { name } = folder;
  try {
    await renameRecorded(app, folder, to);
  } catch (error) {
    console.error('Buba: folder not renamed', error);
    new Notice(t('folderRenameFailed', { name }));
  }
}

/** Deletes a folder after a confirmation: Obsidian's, or the reference dialog when it holds references. */
export async function deleteFolder(app: App, folder: TFolder, passports?: PassportReader): Promise<void> {
  const { name, path } = folder;
  const files = filesIn(folder);
  const uses = referencesOf(files, passports);
  const remove =
    uses.length && passports
      ? async (item: TAbstractFile): Promise<boolean> => {
          if (!(await confirmDeleteFolder(app, name, files, uses, passports))) return false;
          await app.fileManager.trashFile(item);
          return true;
        }
      : viaPrompt(app);
  try {
    const run = await deleteRecorded(app, [folder], coreSetting(app, 'trashOption'), remove);
    if (run.failed.length) new Notice(t('folderDeleteFailed', { name }));
  } catch (error) {
    console.error('Buba: folder not deleted', path, error);
    new Notice(t('folderDeleteFailed', { name }));
  }
  if (!app.vault.getAbstractFileByPath(path)) leaveDeleted(app, path);
}

/**
 * Deletes several folders picked in the tree after one confirmation with their count and the count of files
 * inside, the reference dialog when some files are references of generations; each goes with `trashFile`
 * by the "Deleted files" setting, its files marked as Buba's own deletes. One failure does not stop the rest.
 */
export async function deleteFolders(
  app: App,
  folders: readonly TFolder[],
  passports?: PassportReader,
): Promise<void> {
  const files = folders.flatMap(filesIn);
  if (!(await confirmDeleteFolders(app, folders.length, files, passports))) return;
  let failed = false;
  try {
    const run = await deleteRecorded(app, folders, coreSetting(app, 'trashOption'), viaTrashFile(app));
    failed = run.failed.length > 0;
  } catch (error) {
    console.error('Buba: folders not deleted', error);
    failed = true;
  }
  for (const { path } of folders) if (!app.vault.getAbstractFileByPath(path)) leaveDeleted(app, path);
  if (failed) new Notice(t('foldersDeleteFailed'));
}

/** Grid tabs on the deleted folder or inside it go to the folder it was in; a tab on a module source stays. */
function leaveDeleted(app: App, deleted: string): void {
  for (const leaf of app.workspace.getLeavesOfType(GRID_VIEW_TYPE)) {
    const view = leaf.view as unknown as { setGridState?(patch: { folder: string }): void };
    const state = normalizeGridViewState(leaf.view.getState());
    const next = deleteGridFolder(state, deleted);
    if (next !== state && !state.source && next.folder !== null) view.setGridState?.({ folder: next.folder });
  }
}

/** All files inside a folder, at any depth. */
function filesIn(folder: TAbstractFile): TFile[] {
  if (!(folder instanceof TFolder)) return [];
  return folder.children.flatMap((child) =>
    child instanceof TFolder ? filesIn(child) : child instanceof TFile ? [child] : [],
  );
}
