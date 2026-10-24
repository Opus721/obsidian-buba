// Adapter from Obsidian vault events to the tag, rating and comment storage. A move inside Obsidian is a
// `rename` of a file or folder; a move in the system file manager arrives as create + delete with no
// `rename`, and the storage pairs them by fingerprint. Everything in the data folders (`__buba-data/` and the
// old `Buba/`) is service data, not user files: a foreign journal arriving via sync triggers an index
// rebuild, own journals are written by the storage itself. Only types come from `obsidian`: the package has
// no runtime code and the test runs in node.
import type { Plugin, TAbstractFile, TFile } from 'obsidian';
import type { Store } from '../../core/storage/store.ts';
import { DATA_DIRS, inDataDir, type Fingerprint } from '../../core/storage/types.ts';

/** What the adapter calls on the storage. */
export type VaultEventsTarget = Pick<
  Store,
  'reload' | 'fileRenamed' | 'fileAppeared' | 'fileDisappeared' | 'fileChanged' | 'expire'
>;

/** Edits to foreign journals from the first one in a burst until this delay give one index rebuild, ms. */
const RELOAD_AFTER_MS = 1000;
/** How often the storage clears the move-pairing window, ms. */
const EXPIRE_EVERY_MS = 1000;

/** Tells a file from a folder by its `extension` field: `instanceof TFile` does not work in node. */
const isFile = (item: TAbstractFile): item is TFile => typeof (item as Partial<TFile>).extension === 'string';

/** Data folders (new and old) and everything in them are service data, not user files. */
export const inJournalDir = (path: string): boolean => inDataDir(path);

/**
 * A foreign journal is a `.jsonl` directly in any data folder, as `readAll` reads them, and not our own:
 * `ownJournalPrefix` is `__buba-data/<device>-`.
 */
export function isForeignJournal(path: string, ownJournalPrefix: string): boolean {
  const dir = DATA_DIRS.find((each) => path.startsWith(`${each}/`));
  if (dir === undefined) return false;
  const name = path.slice(dir.length + 1);
  if (name.includes('/') || !name.endsWith('.jsonl')) return false;
  return !path.startsWith(ownJournalPrefix);
}

/** Fingerprint used to pair the two halves of a move. */
export const fingerprintOf = (file: TFile): Fingerprint => ({
  size: file.stat.size,
  mtime: file.stat.mtime,
  name: file.name,
});

/** Storage failures go to the console: one failed event does not stop the following ones. */
function run(task: Promise<unknown>): void {
  task.catch((error: unknown) => console.error("Buba: storage didn't accept a vault event", error));
}

/**
 * Subscribes the storage to vault events via `registerEvent`, so plugin unload removes them. Call after
 * `onLayoutReady`: before it, `create` fires for every file being loaded. `ownJournalPrefix` is
 * `__buba-data/<device>-`.
 */
export function bindVaultEvents(plugin: Plugin, engine: VaultEventsTarget, ownJournalPrefix: string): void {
  const { vault } = plugin.app;
  let reload: number | null = null;

  /**
   * The first edit of a foreign journal schedules a rebuild in a second; later edits within that second join
   * it: sync delivers a journal in several writes.
   */
  function journalTouched(path: string): void {
    if (!isForeignJournal(path, ownJournalPrefix) || reload !== null) return;
    reload = window.setTimeout(() => {
      reload = null;
      run(engine.reload());
    }, RELOAD_AFTER_MS);
  }
  plugin.register(() => {
    if (reload !== null) window.clearTimeout(reload);
  });

  const onFile = (event: 'fileAppeared' | 'fileDisappeared' | 'fileChanged') => (item: TAbstractFile) => {
    if (inJournalDir(item.path)) journalTouched(item.path);
    else if (isFile(item)) run(engine[event](item.path, fingerprintOf(item)));
  };
  plugin.registerEvent(vault.on('create', onFile('fileAppeared')));
  plugin.registerEvent(vault.on('delete', onFile('fileDisappeared')));
  plugin.registerEvent(vault.on('modify', onFile('fileChanged')));
  // Folders too: a folder `rename` arrives before its children's, and the storage writes one line for it
  // (measured).
  plugin.registerEvent(
    vault.on('rename', (item, oldPath) => {
      if (!inJournalDir(oldPath) && !inJournalDir(item.path))
        return run(engine.fileRenamed(oldPath, item.path));
      journalTouched(oldPath);
      journalTouched(item.path);
    }),
  );
  plugin.registerInterval(window.setInterval(() => run(engine.expire()), EXPIRE_EVERY_MS));
}
