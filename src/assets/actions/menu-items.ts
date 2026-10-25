// "Rename", "Make a copy" and "Delete" in the tile menu: Obsidian does not add them to a plugin-built menu,
// only to its own file explorer menu. They come through the same file menu event with source `buba-grid`
// (file-menu.ts), the way Notebook Navigator and GridExplorer add items next to `file-menu`. Public API only:
// rename uses our dialog and `fileManager.renameFile`, copy `vault.copy`, deleting one file
// `fileManager.promptForDeletion`, a batch a confirmation with the file count and `fileManager.trashFile`; a
// file that is a reference of generations gets our dialog naming them (generation passports, read from
// storage), since Obsidian's dialog cannot say what the delete takes from them.
// Names are shown as text only. Group order: "Rename", "…with extension…" and "Make a copy" come through the
// `buba:tile-menu` event before `file-menu`, in their own `buba-file` section right after tags, "Move file
// to..." and "Bookmark..."; "Delete" comes through `file-menu` and `files-menu`, in the `danger` section,
// last. All carry the "Buba" label on the right (src/platform/menu-title.ts).
import {
  ButtonComponent,
  ItemView,
  Modal,
  Notice,
  Setting,
  TFile,
  type App,
  type Events,
  type Menu,
  type Plugin,
  type TextComponent,
} from 'obsidian';
import { availablePath } from '../../core/actions/import-names.ts';
import { generationCount, referenceUse, type ReferenceUse } from '../../core/generation/delete.ts';
import { t } from '../../core/i18n/dict/actions.ts';
import { renameField, renameTarget } from '../../core/actions/rename.ts';
import { GENERATION_SECTION, SHOW_PANEL, USED_SECTION } from '../../core/inspector/events.ts';
import type { FilePassports } from '../../core/storage/types.ts';
import { isTypingTarget } from '../../core/tags/keys.ts';
import { settingsOf } from '../../platform/settings.ts';
import { trashLine } from '../../core/actions/trash-text.ts';
import { ownTitle } from '../../platform/menu-title.ts';
import { coreSetting } from '../../platform/core-settings.ts';
import { deleteRecorded, renameRecorded, viaPrompt, viaTrashFile } from '../../platform/files/undo.ts';
import { passportStorage } from '../../platform/passports.ts';
import type { BubaAssets } from '../api.ts';
import { MENU_SOURCE, TILE_MENU } from './file-menu.ts';

export function registerMenuItems(plugin: Plugin, assets: BubaAssets): void {
  const { app } = plugin;
  plugin.registerEvent(
    (app.workspace as Events).on(TILE_MENU, (...data: unknown[]) => {
      const [menu, files] = data as [Menu, unknown];
      const file = Array.isArray(files) && files.length === 1 ? (files[0] as unknown) : null;
      if (file instanceof TFile) addFileItems(app, menu, file);
    }),
  );
  plugin.registerEvent(
    app.workspace.on('file-menu', (menu, file, source) => {
      if (source === MENU_SOURCE && file instanceof TFile) addDelete(plugin, menu, file);
    }),
  );
  plugin.registerEvent(
    app.workspace.on('files-menu', (menu, files, source) => {
      if (source !== MENU_SOURCE) return;
      const list = files.filter((file): file is TFile => file instanceof TFile);
      if (list.length) addDeleteMany(plugin, menu, list);
    }),
  );
  const wired = new WeakSet<object>();
  const install = (): void => {
    for (const view of assets.gridViews()) {
      const { scope } = view;
      if (!(view instanceof ItemView) || !scope || wired.has(view)) continue;
      wired.add(view);
      const handler = scope.register(null, null, (evt) => {
        if (
          evt.key !== 'Delete' ||
          evt.isComposing ||
          evt.keyCode === 229 ||
          evt.ctrlKey ||
          evt.metaKey ||
          evt.altKey ||
          evt.shiftKey ||
          !settingsOf(plugin).gridKeys ||
          isTypingTarget(evt.target as Element | null)
        )
          return undefined;
        const files = (view.selectedPaths?.() ?? [])
          .map((path) => app.vault.getAbstractFileByPath(path))
          .filter((file): file is TFile => file instanceof TFile);
        if (!files.length) return undefined;
        if (!evt.repeat) deleteFiles(app, files, passportStorage(plugin));
        return false;
      });
      view.register(() => scope.unregister(handler));
    }
  };
  app.workspace.onLayoutReady(install);
  plugin.registerEvent(app.workspace.on('layout-change', install));
}

/** Single-file tile items added before `file-menu`: rename and copy, as their own group. */
function addFileItems(app: App, menu: Menu, file: TFile): void {
  menu.addItem((item) =>
    item
      .setTitle(ownTitle(t('rename')))
      .setIcon('pencil')
      .setSection('buba-file')
      .onClick(() => new RenameFileModal(app, file).open()),
  );
  menu.addItem((item) =>
    item
      .setTitle(ownTitle(t('renameWithExtension')))
      .setIcon('pencil')
      .setSection('buba-file')
      .onClick(() => new RenameFileModal(app, file, true).open()),
  );
  menu.addItem((item) =>
    item
      .setTitle(ownTitle(t('makeCopy')))
      .setIcon('copy')
      .setSection('buba-file')
      .onClick(() => void copyFile(app, file)),
  );
}

/** "Delete" for a single tile file, via `file-menu`, in the last section. */
function addDelete(plugin: Plugin, menu: Menu, file: TFile): void {
  menu.addItem((item) =>
    item
      .setTitle(ownTitle(t('delete')))
      .setIcon('trash-2')
      .setSection('danger')
      .setWarning(true)
      .onClick(() => deleteFiles(plugin.app, [file], passportStorage(plugin))),
  );
}

function addDeleteMany(plugin: Plugin, menu: Menu, files: readonly TFile[]): void {
  menu.addItem((item) =>
    item
      .setTitle(ownTitle(t('deleteCount', { count: files.length })))
      .setIcon('trash-2')
      .setSection('danger')
      .setWarning(true)
      .onClick(() => deleteFiles(plugin.app, files, passportStorage(plugin))),
  );
}

/** What the delete dialogs read of generation passports; plugin storage, `undefined` until it opens. */
export type PassportReader = Pick<FilePassports, 'passport' | 'usedIn'>;

/** Files of the batch that stay references of other generations. */
export function referencesOf(files: readonly TFile[], passports?: PassportReader): ReferenceUse[] {
  return passports
    ? referenceUse(
        files.map(({ path }) => path),
        (path) => passports.usedIn(path),
      )
    : [];
}

/**
 * One delete path for the key, the menu and the command: a reference of generations gets our dialog that
 * names them, otherwise one file gets Obsidian's confirmation and a batch our dialog.
 */
export function deleteFiles(app: App, files: readonly TFile[], passports?: PassportReader): void {
  const uses = referencesOf(files, passports);
  if (uses.length && passports) new ReferenceDeleteModal(app, files, uses, passports).open();
  else if (files.length === 1 && files[0]) void deleteOne(app, files[0]);
  else if (files.length > 1) new DeleteFilesModal(app, files).open();
}

/** Whether a path is taken in the file's folder, in any case: Windows disks are case-insensitive. */
function takenIn(file: TFile): (path: string) => boolean {
  const siblings = new Set((file.parent?.children ?? []).map((child) => child.path.toLowerCase()));
  return (path) => siblings.has(path.toLowerCase());
}

/** A copy next to the file under a free name "name 1.png", as Obsidian does; the original is untouched. */
export async function copyFile(app: App, file: TFile): Promise<void> {
  const to = availablePath(file.parent?.path ?? '/', file.name, takenIn(file));
  try {
    await app.vault.copy(file, to);
  } catch (error) {
    console.error('Buba: copy not created', error);
    new Notice(t('copyFailed', { name: file.name }));
  }
}

/** A field with the name without extension; Enter or "Rename" checks it in core; a refusal shows a notice. */
export class RenameFileModal extends Modal {
  readonly #file: TFile;
  readonly #full: boolean;
  #input: TextComponent | null = null;

  constructor(app: App, file: TFile, full = false) {
    super(app);
    this.#file = file;
    this.#full = full;
  }

  override onOpen(): void {
    this.setTitle(this.#full ? t('renameTitleWithExtension') : t('renameTitle'));
    new Setting(this.contentEl).setName(t('newName')).addText((text) => {
      this.#input = text.setValue(renameField(this.#file.path, this.#full));
    });
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText(t('renameButton'))
        .setCta()
        .onClick(() => void this.#submit()),
    );
    this.scope.register([], 'Enter', (evt) => {
      if (evt.isComposing) return;
      void this.#submit();
      return false;
    });
    this.#input?.inputEl.select();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  async #submit(): Promise<void> {
    const file = this.#file;
    const target = renameTarget(file.path, this.#input?.getValue() ?? '', takenIn(file), this.#full);
    if (!target.ok) {
      new Notice(target.why);
      return;
    }
    this.close();
    try {
      await renameRecorded(this.app, file, target.to);
    } catch (error) {
      console.error('Buba: file not renamed', error);
      new Notice(t('renameFailed', { name: file.name }));
    }
  }
}

/**
 * "Delete" for one file uses Obsidian's `promptForDeletion` dialog, as in
 * Obsidian's file explorer; once deleted, an undo step is recorded, and a check
 * of Obsidian's trash finds where the file went (src/platform/files/undo.ts).
 */
async function deleteOne(app: App, file: TFile): Promise<void> {
  try {
    const run = await deleteRecorded(app, [file], coreSetting(app, 'trashOption'), viaPrompt(app));
    if (run.failed.length) new Notice(t('deleteFailed', { name: file.name }));
  } catch (error) {
    console.error('Buba: file not deleted', file.path, error);
    new Notice(t('deleteFailed', { name: file.name }));
  }
}

/**
 * Asks to delete `files`: `true` on "Delete", `false` on Cancel, close or Esc; the caller deletes them. A
 * reference of generations gets the dialog that names them.
 */
export function confirmDeleteFiles(
  app: App,
  files: readonly TFile[],
  passports?: PassportReader,
): Promise<boolean> {
  const uses = referencesOf(files, passports);
  return new Promise((done) =>
    (uses.length && passports
      ? new ReferenceDeleteModal(app, files, uses, passports, done)
      : new DeleteFilesModal(app, files, done)
    ).open(),
  );
}

/**
 * Asks to delete folder `name` whose `files` include references of generations (`uses`): the reference
 * dialog in its batch form, titled with the folder. `true` on "Delete"; the caller deletes the folder.
 */
export function confirmDeleteFolder(
  app: App,
  name: string,
  files: readonly TFile[],
  uses: readonly ReferenceUse[],
  passports: PassportReader,
): Promise<boolean> {
  return new Promise((done) => new ReferenceDeleteModal(app, files, uses, passports, done, name).open());
}

/**
 * Batch confirmation with the file count, like Obsidian's delete dialog: Cancel, then a red "Delete". It
 * mimics Obsidian's confirmation dialog: `mod-confirmation` on `containerEl` and `mod-cancel` on Cancel, as
 * Obsidian's `ConfirmationModal` and `setCancel` set them (both exist only since 1.13, and the plugin also
 * installs on 1.12.3); on iPhone these classes put the dialog at the bottom without a close button, with
 * Cancel at the bottom (`.is-mobile` and `.is-phone` rules in Obsidian's app.css); on desktop they have no
 * rules. The answer goes to `done`: "Delete" gives `true`; Cancel, close and Esc give `false` and nothing is
 * deleted. Without `done`, "Delete" removes each file with `trashFile` (where to is Obsidian's "Files and
 * links" setting) and reports the result in a notice.
 */
class DeleteFilesModal extends Modal {
  readonly #files: readonly TFile[];
  readonly #done: (confirmed: boolean) => void;
  #confirmed = false;
  #buttons: HTMLElement | null = null;

  constructor(
    app: App,
    files: readonly TFile[],
    done: (confirmed: boolean) => void = (confirmed) => {
      if (confirmed) void trashFiles(app, files);
    },
  ) {
    super(app);
    this.#files = files;
    this.#done = done;
    this.containerEl.addClass('mod-confirmation');
  }

  override onOpen(): void {
    const n = this.#files.length;
    this.setTitle(t('deleteFilesTitle'));
    this.contentEl.createEl('p', { text: t('deleteFilesConfirm', { count: n }) });
    // Where the files go follows Obsidian's "Deleted files" setting, read each time the dialog opens.
    const { text, warning } = trashLine(coreSetting(this.app, 'trashOption'));
    this.contentEl.createEl('p', { text }).toggleClass('mod-warning', warning);
    const buttons = (this.#buttons = this.modalEl.createDiv({ cls: 'modal-button-container' }));
    new ButtonComponent(buttons)
      .setButtonText(t('cancel'))
      .setClass('mod-cancel')
      .onClick(() => this.close());
    new ButtonComponent(buttons)
      .setButtonText(t('deleteButton'))
      .setDestructive()
      .setCta()
      .onClick(() => {
        this.#confirmed = true;
        this.close();
      });
  }

  override onClose(): void {
    this.contentEl.empty();
    this.#buttons?.remove();
    this.#buttons = null;
    this.#done(this.#confirmed);
  }
}

/** Names listed in the reference dialog before "and N more". */
const LISTED = 5;

/**
 * Delete confirmation for files that are references of generations, laid out as the "Delete files" dialog
 * (`mod-confirmation`, Cancel with `mod-cancel`, a red "Delete"). One file: its name in the title, the
 * number of generations, up to five of them by name and model (a name shows that generation in the file
 * panel) and "Show generations", which closes the dialog and shows the file's "Used in generations"
 * section. A batch: the file count, how many are references in how many generations, up to five reference
 * names (a name shows its "Used in generations"). Then what happens to those generations and where the
 * files go. "Delete" trashes them with `trashFile` and one undo step, as the batch dialog does; without
 * `done` it deletes them itself. With `folder` it asks about deleting that folder (the Buba tree's
 * "Delete"): the batch form with the folder name in the title and its file count.
 */
class ReferenceDeleteModal extends Modal {
  readonly #files: readonly TFile[];
  readonly #uses: readonly ReferenceUse[];
  readonly #passports: PassportReader;
  readonly #done: (confirmed: boolean) => void;
  readonly #folder: string | null;
  #confirmed = false;
  #buttons: HTMLElement | null = null;

  constructor(
    app: App,
    files: readonly TFile[],
    uses: readonly ReferenceUse[],
    passports: PassportReader,
    done: (confirmed: boolean) => void = (confirmed) => {
      if (confirmed) void trashFiles(app, files);
    },
    folder: string | null = null,
  ) {
    super(app);
    this.#files = files;
    this.#uses = uses;
    this.#passports = passports;
    this.#done = done;
    this.#folder = folder;
    this.containerEl.addClass('mod-confirmation');
  }

  override onOpen(): void {
    const { contentEl } = this;
    const [only] = this.#files;
    const one = this.#files.length === 1 && only && this.#folder === null ? only : null;
    const count = generationCount(this.#uses);
    if (one) {
      this.setTitle(t('deleteRefTitle', { name: one.name }));
      contentEl.createEl('p', { text: t('refOfGenerations', { count }) });
      const results = this.#uses.flatMap(({ results }) => results);
      this.#list(
        results.map((path) => {
          const model = this.#passports.passport(path)?.model;
          const name = path.slice(path.lastIndexOf('/') + 1);
          return { text: model ? `${name} · ${model}` : name, path, section: GENERATION_SECTION };
        }),
      );
    } else if (this.#folder !== null) {
      this.setTitle(t('deleteFolderTitle', { name: this.#folder }));
      contentEl.createEl('p', { text: t('folderFilesCount', { count: this.#files.length }) });
    } else {
      this.setTitle(t('deleteFilesTitle'));
      contentEl.createEl('p', { text: t('deleteFilesConfirm', { count: this.#files.length }) });
    }
    if (!one) {
      contentEl.createEl('p', {
        text: `${t('refsInBatch', { count: this.#uses.length })} ${t('inGenerations', { count })}`,
      });
      this.#list(
        this.#uses.map(({ path }) => ({
          text: path.slice(path.lastIndexOf('/') + 1),
          path,
          section: USED_SECTION,
        })),
      );
    }
    contentEl.createEl('p', { text: t('refsAfterDelete', { count }) });
    const { text, warning } = trashLine(coreSetting(this.app, 'trashOption'), one !== null);
    contentEl.createEl('p', { text }).toggleClass('mod-warning', warning);
    const buttons = (this.#buttons = this.modalEl.createDiv({ cls: 'modal-button-container' }));
    if (one)
      new ButtonComponent(buttons).setButtonText(t('showGenerations')).onClick(() => {
        this.close();
        this.app.workspace.trigger(SHOW_PANEL, one.path, USED_SECTION);
      });
    new ButtonComponent(buttons)
      .setButtonText(t('cancel'))
      .setClass('mod-cancel')
      .onClick(() => this.close());
    new ButtonComponent(buttons)
      .setButtonText(t('deleteButton'))
      .setDestructive()
      .setCta()
      .onClick(() => {
        this.#confirmed = true;
        this.close();
      });
  }

  /** Up to `LISTED` names as links to the file panel, then "and N more". */
  #list(items: readonly { text: string; path: string; section: string }[]): void {
    const list = this.contentEl.createEl('ul');
    for (const { text, path, section } of items.slice(0, LISTED)) {
      const link = list.createEl('li').createEl('a', { text, attr: { href: '#' } });
      link.addEventListener('click', (evt) => {
        evt.preventDefault();
        this.close();
        this.app.workspace.trigger(SHOW_PANEL, path, section);
      });
    }
    if (items.length > LISTED) list.createEl('li', { text: t('andMore', { count: items.length - LISTED }) });
  }

  override onClose(): void {
    this.contentEl.empty();
    this.#buttons?.remove();
    this.#buttons = null;
    this.#done(this.#confirmed);
  }
}

/**
 * Trashes files one by one and records one undo step; one failure does not stop the batch; a notice reports.
 */
async function trashFiles(app: App, files: readonly TFile[]): Promise<void> {
  let run;
  try {
    run = await deleteRecorded(app, files, coreSetting(app, 'trashOption'), viaTrashFile(app));
  } catch (error) {
    console.error('Buba: files not deleted', error);
    new Notice(t('deleteFilesFailed'));
    return;
  }
  const done = run.ops.length;
  const failed = run.failed.length;
  new Notice(
    failed ? t('deletedSome', { count: files.length, done, failed }) : t('deletedAll', { count: done }),
  );
}
