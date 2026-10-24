// Notice after a reference of generations is deleted outside Buba: in Obsidian's file explorer, on a board,
// in the system file manager or by sync. Obsidian gives a plugin no way to ask before such a delete, so
// Buba tells after it. A move in the system file manager arrives as "deleted" and "created"; storage pairs
// them within its move window and moves the references, so the check waits for the stream of vault events
// to go quiet for that window and only then looks whether the path is still gone and still named by a
// generation. Deletes Buba made itself were confirmed in its own dialog and are skipped. One notice per
// stream: the file and its generation count, or the number of files.
import { Notice, TFile, type Plugin, type TAbstractFile } from 'obsidian';
import { referenceUse } from '../core/generation/delete.ts';
import { t } from '../core/i18n/dict/generation.ts';
import { MOVE_WINDOW_MS } from '../core/storage/fingerprint.ts';
import { inDataDir } from '../core/storage/types.ts';
import { isOwnDelete } from '../platform/files/own-deletes.ts';
import { passportStorage } from '../platform/passports.ts';

/** Wait beyond the move window: storage's own timer starts at the same event. */
const MARGIN_MS = 500;

export function registerDeletedOutside(plugin: Plugin): void {
  const { app } = plugin;
  const pending = new Set<string>();
  let timer: number | null = null;
  const check = (): void => {
    timer = null;
    const paths = [...pending];
    pending.clear();
    const storage = passportStorage(plugin);
    if (!storage) return;
    const gone = paths.filter((path) => !app.vault.getAbstractFileByPath(path));
    const uses = referenceUse(gone, (path) => storage.usedIn(path));
    const [first] = uses;
    if (!first) return;
    new Notice(
      uses.length === 1
        ? t('deletedOutside', {
            count: first.results.length,
            name: first.path.slice(first.path.lastIndexOf('/') + 1),
          })
        : t('deletedOutsideMany', { count: uses.length }),
    );
  };
  /** Any vault event keeps the stream going; the check runs once it has been quiet. */
  const wait = (): void => {
    if (!pending.size) return;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(check, MOVE_WINDOW_MS + MARGIN_MS);
  };
  plugin.registerEvent(
    app.vault.on('delete', (file: TAbstractFile) => {
      if (file instanceof TFile && !inDataDir(file.path) && !isOwnDelete(file.path)) pending.add(file.path);
      wait();
    }),
  );
  plugin.registerEvent(app.vault.on('create', wait));
  plugin.registerEvent(app.vault.on('rename', wait));
  plugin.register(() => {
    if (timer !== null) window.clearTimeout(timer);
  });
}
