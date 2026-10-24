// The `__buba-data` data folder: own journals are migrated from the old `Buba` folder by copying (the old
// folder is never changed or deleted), and own journals lost while Obsidian is open are restored from memory.
// Each device copies and restores only its own files, since it writes only its own. Only types come from
// `obsidian`: the package has no runtime code and the test runs in node; `src/main.ts` shows the notice via
// the `warn` callback.
import type { App, Plugin, TAbstractFile } from 'obsidian';
import { ACTIONS_DIR } from '../../core/actions/journal.ts';
import { t } from '../../core/i18n/dict/platform.ts';
import { missingLines } from '../../core/storage/data-dir.ts';
import { JOURNAL_DIR, LEGACY_JOURNAL_DIR } from '../../core/storage/types.ts';
import { appendJournal, heldJournals, serialJournal } from './journal-append.ts';
import { ensureJournalDir, restoreNote } from './vault-io.ts';

const LEGACY_ACTIONS = `${LEGACY_JOURNAL_DIR}/actions`;

/**
 * Own journals (tags and actions) of the old folder: copied if missing in the new one; if present but the old
 * one changed later (an old build appended after a rollback), the missing lines are appended to the new one.
 * Foreign journals are left alone. Returns how many files were touched.
 */
export async function migrateOwnJournals(app: App, device: string): Promise<number> {
  const { adapter } = app.vault;
  if (!(await adapter.exists(LEGACY_JOURNAL_DIR))) return 0;
  const own = (file: string, dir: string): boolean => {
    const name = file.slice(dir.length + 1);
    return name.startsWith(`${device}-`) && name.endsWith('.jsonl') && !name.includes('/');
  };
  const copies: [from: string, to: string][] = [];
  const topUps: [from: string, to: string][] = [];
  for (const [from, to] of [
    [LEGACY_JOURNAL_DIR, JOURNAL_DIR],
    [LEGACY_ACTIONS, ACTIONS_DIR],
  ] as const) {
    if (!(await adapter.exists(from))) continue;
    for (const file of (await adapter.list(from)).files) {
      if (!own(file, from)) continue;
      const target = `${to}/${file.slice(from.length + 1)}`;
      if (!(await adapter.exists(target))) copies.push([file, target]);
      else if (((await adapter.stat(file))?.mtime ?? 0) > ((await adapter.stat(target))?.mtime ?? 0))
        topUps.push([file, target]);
    }
  }
  if (copies.length) {
    await ensureJournalDir(app);
    if (copies.some(([, to]) => to.startsWith(`${ACTIONS_DIR}/`)) && !(await adapter.exists(ACTIONS_DIR)))
      await adapter.mkdir(ACTIONS_DIR);
    for (const [from, to] of copies) await adapter.copy(from, to);
  }
  let topped = 0;
  for (const [from, to] of topUps) {
    const rest = missingLines(await adapter.read(from), await adapter.read(to));
    if (!rest.length) continue;
    await appendJournal(adapter, to, `${rest.join('\n')}\n`);
    topped++;
  }
  return copies.length + topped;
}

/**
 * Delay after the first deletion in a burst before restoring, ms: deleting a folder fires an event per file.
 */
const RESTORE_AFTER_MS = 300;

/**
 * When an own journal disappears (file deleted, data folder deleted or renamed away), after
 * `RESTORE_AFTER_MS` restores from memory every own journal missing on disk. Foreign journals are never
 * written: their own devices restore them. A notice is shown only when the data folder itself disappeared.
 */
export function guardDataDir(plugin: Plugin, warn: (text: string) => void): void {
  const { vault } = plugin.app;
  const { adapter } = vault;
  let timer: number | null = null;
  let folderGone = false;
  const schedule = (folder: boolean): void => {
    folderGone ||= folder;
    if (timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      const loud = folderGone;
      folderGone = false;
      restore(loud).catch((error: unknown) => console.error("Buba: data folder didn't come back", error));
    }, RESTORE_AFTER_MS);
  };
  plugin.register(() => {
    if (timer !== null) window.clearTimeout(timer);
  });

  const restore = (loud: boolean) =>
    serialJournal(adapter, async () => {
      const started = performance.now();
      const back: string[] = [];
      const held = heldJournals(adapter);
      for (const [file, text] of held) {
        if (await adapter.exists(file)) continue;
        for (const dir of [JOURNAL_DIR, file.slice(0, file.lastIndexOf('/'))])
          if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
        await adapter.write(file, text);
        back.push(file);
      }
      const noteBack = await restoreNote(adapter);
      if (!back.length && !noteBack && !loud) return;
      console.debug(
        `Buba: own logs restored — ${back.length} in ${Math.round(performance.now() - started)} ms`,
      );
      // With no own records in memory (the device wrote and read nothing) there is nothing to restore and the
      // notice would lie. An own journal already restored by the first append during the wait counts as
      // restored.
      if (loud && held.size > 0) warn(t('dataDirRestored'));
    });

  const isFolder = (path: string): boolean => path === JOURNAL_DIR;
  const inDir = (path: string): boolean => path === JOURNAL_DIR || path.startsWith(`${JOURNAL_DIR}/`);
  plugin.registerEvent(
    vault.on('delete', (item: TAbstractFile) => {
      if (inDir(item.path)) schedule(isFolder(item.path));
    }),
  );
  plugin.registerEvent(
    vault.on('rename', (item: TAbstractFile, oldPath: string) => {
      if (inDir(oldPath) && !inDir(item.path)) schedule(isFolder(oldPath));
    }),
  );
  // The folder exists without its note (deleted while Obsidian was closed): restore the note.
  void serialJournal(adapter, async () => {
    await restoreNote(adapter);
  });
}
