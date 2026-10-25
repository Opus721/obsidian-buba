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
// elsewhere leaves its tab where it was (src/assets/grid/view.ts).
import { Notice, type App, type TAbstractFile, type TFile, type TFolder } from 'obsidian';
import { renameFolderTarget } from '../../core/actions/new-folder.ts';
import { deleteGridFolder, GRID_VIEW_TYPE, normalizeGridViewState } from '../../core/layout/view-state.ts';
import { t } from '../../core/i18n/dict/tree.ts';
import { markOwnDelete, settleOwnDelete } from '../../platform/files/own-deletes.ts';
import { renameRecorded } from '../../platform/files/undo.ts';
import { confirmDeleteFolder, referencesOf, type PassportReader } from '../actions/menu-items.ts';
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
  try {
    if (uses.length && passports) {
      if (await confirmDeleteFolder(app, name, files, uses, passports)) await trashMarked(app, folder, files);
    } else await app.fileManager.promptForDeletion(folder);
  } catch (error) {
    console.error('Buba: folder not deleted', path, error);
    new Notice(t('folderDeleteFailed', { name }));
  }
  if (!app.vault.getAbstractFileByPath(path)) leaveDeleted(app, path);
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

/** `trashFile` with the files inside marked as Buba's own deletes for the time of the call and a bit after. */
async function trashMarked(app: App, folder: TFolder, files: readonly TFile[]): Promise<void> {
  for (const { path } of files) markOwnDelete(path);
  let deleted = false;
  try {
    await app.fileManager.trashFile(folder);
    deleted = true;
  } finally {
    for (const { path } of files) settleOwnDelete(path, deleted);
  }
}

/** All files inside a folder, at any depth. */
function filesIn(folder: TAbstractFile): TFile[] {
  const children = (folder as { children?: TAbstractFile[] }).children;
  return children
    ? children.flatMap((child) => ('children' in child ? filesIn(child) : [child as TFile]))
    : [];
}
