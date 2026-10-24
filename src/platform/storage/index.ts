// Opens the tag, rating and comment storage on plugin load: device id and journal adapters here, the storage
// itself in core. Journals are read at once; vault events and the disk check wait for `onLayoutReady`: before
// it, `create` fires for every file being loaded, and the check finds files moved in a file manager while
// Obsidian was closed. A foreign journal that lands on disk between the read and the subscription produces no
// event for anyone; the snapshot comparison of foreign journals at subscription time catches it.
import type { App, Plugin } from 'obsidian';
import { createStore } from '../../core/storage/store.ts';
import { DATA_DIRS, JOURNAL_DIR, type StorageEngine } from '../../core/storage/types.ts';
import { deviceId } from '../device.ts';
import { bindVaultEvents, fingerprintOf, inJournalDir, isForeignJournal } from './events.ts';
import { guardDataDir, migrateOwnJournals } from './data-dir.ts';
import { createVaultJournalIO } from './vault-io.ts';

/**
 * Snapshot of foreign journals on disk: path → size and modification time. The time alone is not enough: sync
 * may bring a file with another device's timestamp, so both the set of files and their sizes are compared.
 */
async function foreignJournals(app: App, ownJournalPrefix: string): Promise<Map<string, string>> {
  const { adapter } = app.vault;
  const files: string[] = [];
  for (const dir of DATA_DIRS) if (await adapter.exists(dir)) files.push(...(await adapter.list(dir)).files);
  const journals = files.filter((path) => isForeignJournal(path, ownJournalPrefix));
  const stats = await Promise.all(journals.map((path) => adapter.stat(path)));
  return new Map(journals.map((path, at) => [path, `${stats[at]?.size}:${stats[at]?.mtime}`]));
}

const sameJournals = (a: Map<string, string>, b: Map<string, string>): boolean =>
  a.size === b.size && [...a].every(([path, mark]) => b.get(path) === mark);

export async function openStorage(
  plugin: Plugin,
  warn: (text: string) => void = () => {},
): Promise<StorageEngine> {
  const { app } = plugin;
  const device = deviceId(app);
  const ownJournalPrefix = `${JOURNAL_DIR}/${device}-`;
  // Own journals from the old folder are copied to the new one before reading; a failure goes to the console,
  // and both folders are read anyway. The move is logged only when something moved: Obsidian's plugin
  // guidelines want a silent console on a normal load, errors aside.
  const migrateStarted = performance.now();
  await migrateOwnJournals(app, device)
    .then((count) => {
      if (count > 0)
        console.debug(
          `Buba: move — ${count} own logs in ${Math.round(performance.now() - migrateStarted)} ms`,
        );
    })
    .catch((error: unknown) => console.error('Buba: moving own logs to the data folder failed', error));
  const io = createVaultJournalIO(app, device);
  const store = createStore({
    io,
    device,
    now: () => Date.now(),
    statOf: (path) => app.vault.getFileByPath(path)?.stat,
  });
  // Snapshot before reading: a journal landing between snapshot and read costs one extra rebuild, while the
  // reverse order would lose it. Without a snapshot the subscription triggers a rebuild without comparing.
  const read = await foreignJournals(app, ownJournalPrefix).catch(() => null);
  await store.load();
  app.workspace.onLayoutReady(() => {
    bindVaultEvents(plugin, store, ownJournalPrefix);
    guardDataDir(plugin, warn);
    foreignJournals(app, ownJournalPrefix)
      .then((now) => (read && sameJournals(read, now) ? undefined : store.reload()))
      .catch((error: unknown) => console.error("Buba: check of other devices' logs failed", error));
    const files = app.vault
      .getFiles()
      .filter((file) => !inJournalDir(file.path))
      .map((file) => ({ path: file.path, fp: fingerprintOf(file) }));
    store.reconcile(files).catch((error: unknown) => console.error('Buba: check against disk failed', error));
  });
  return store;
}
