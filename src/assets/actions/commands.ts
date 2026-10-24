// Commands for tile menu items on the selection of the active grid: "Rename", "Rename with extension…", "Make
// a copy" and "Delete", the same way as the menu items (menu-items.ts): the rename dialog, a copy next to the
// file, deletion with the same confirmation as the batch menu and the Delete key. Single-file commands are
// available only with exactly one selected file, like the single-file menu items: with two or more,
// Mod+Shift+D does not copy each. Only the active grid's selection counts: in a note the commands are
// unavailable, and a key never acts on a grid selection the user cannot see. Delete and rename have no
// default keys because they delete and move files.
import { ItemView, TFile, type IconName, type Plugin } from 'obsidian';
import { t } from '../../core/i18n/dict/actions.ts';
import { hotkeysOf } from '../../core/settings/hotkeys.ts';
import { passportStorage } from '../../platform/passports.ts';
import type { BubaAssets } from '../api.ts';
import { copyFile, deleteFiles, RenameFileModal } from './menu-items.ts';

export function registerFileCommands(plugin: Plugin, assets: BubaAssets): void {
  const { app } = plugin;
  /** Paths selected in the active grid as they are; none if no grid is active. */
  const selected = (): string[] => {
    const active: unknown = app.workspace.getActiveViewOfType(ItemView);
    const view = assets.gridViews().find((each) => (each as unknown) === active);
    return view?.selectedPaths?.() ?? [];
  };
  const filesOf = (paths: readonly string[]): TFile[] =>
    paths
      .map((path) => app.vault.getAbstractFileByPath(path))
      .filter((file): file is TFile => file instanceof TFile);
  const add = (id: string, name: string, icon: IconName, check: () => (() => void) | null): void => {
    const hotkeys = hotkeysOf(id);
    plugin.addCommand({
      id,
      name,
      icon,
      ...(hotkeys ? { hotkeys } : {}),
      checkCallback: (checking) => {
        const run = check();
        if (!run) return false;
        if (!checking) run();
        return true;
      },
    });
  };
  /** Exactly one selected item, and it is a file. */
  const one = (act: (file: TFile) => void) => () => {
    const paths = selected();
    const [file] = paths.length === 1 ? filesOf(paths) : [];
    return file ? () => act(file) : null;
  };

  add(
    'rename-file',
    t('commandRenameFile'),
    'pencil',
    one((file) => new RenameFileModal(app, file).open()),
  );
  add(
    'rename-file-with-extension',
    t('commandRenameWithExtension'),
    'pencil',
    one((file) => new RenameFileModal(app, file, true).open()),
  );
  add(
    'duplicate-file',
    t('commandDuplicateFile'),
    'copy',
    one((file) => void copyFile(app, file)),
  );
  add('delete-files', t('commandDeleteFiles'), 'trash-2', () => {
    const files = filesOf(selected());
    return files.length ? () => deleteFiles(app, files, passportStorage(plugin)) : null;
  });
}
