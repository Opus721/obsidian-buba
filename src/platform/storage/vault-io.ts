import type { App, DataAdapter } from 'obsidian';
import { strings, t } from '../../core/i18n/dict/platform.ts';
import { mergeLegacy } from '../../core/storage/data-dir.ts';
import { DATA_DIRS, JOURNAL_DIR, type JournalIO } from '../../core/storage/types.ts';
import { appendJournal, holdJournal } from './journal-append.ts';

/**
 * Readme note inside the data folder: what the folder is and how to remove the data for good. Its name and
 * text are in Buba's language at write time. A note in any dictionary language counts, so no second one is
 * written (a computer and a phone sharing a vault may use different languages).
 */
export const noteFile = (): string => `${JOURNAL_DIR}/${t('noteName')}.md`;
export const noteText = (): string => t('noteText');

/** Note paths in every dictionary language. */
function noteFiles(): string[] {
  const names = Object.values(strings).map((language) => language?.noteName);
  return [...new Set(names.filter((name) => name !== undefined))].map((name) => `${JOURNAL_DIR}/${name}.md`);
}

/** The data folder exists but has no note in any language: writes one in Buba's language. */
export async function restoreNote(adapter: DataAdapter): Promise<boolean> {
  if (!(await adapter.exists(JOURNAL_DIR))) return false;
  for (const file of noteFiles()) if (await adapter.exists(file)) return false;
  await adapter.write(noteFile(), noteText());
  return true;
}

/** Creates the data folder at the vault root, with its note, if it is missing. */
export async function ensureJournalDir(app: App): Promise<void> {
  const { adapter } = app.vault;
  if (await adapter.exists(JOURNAL_DIR)) return;
  await adapter.mkdir(JOURNAL_DIR);
  await adapter.write(noteFile(), noteText());
}

/**
 * A journal is a `.jsonl` directly in the data folder, so a write never reaches user files or leaves the
 * vault.
 */
function isJournalFile(file: string): boolean {
  return file.startsWith(`${JOURNAL_DIR}/`) && /^[^/\\]+\.jsonl$/.test(file.slice(JOURNAL_DIR.length + 1));
}

/**
 * Journals go through `vault.adapter`: they are service files, not notes. Measured in Obsidian 1.13.7 on
 * Windows: `adapter.append` creates a missing file but fails with ENOENT in a missing folder, so the folder
 * is created first.
 */
export function createVaultJournalIO(app: App, device?: string): JournalIO {
  const { adapter } = app.vault;
  // Only own journals of the new folder are held in memory, since only those are restored (Buba writes only
  // its own); the old `Buba` folder and foreign journals are not held.
  const own = device === undefined ? null : `${JOURNAL_DIR}/${device}-`;
  return {
    async append(file, text) {
      if (!isJournalFile(file)) {
        throw new RangeError(
          `Log must be a .jsonl file in the ${JOURNAL_DIR} folder, not ${JSON.stringify(file)}`,
        );
      }
      await ensureJournalDir(app);
      await appendJournal(adapter, file, text);
    },
    async readAll() {
      const files: { file: string; text: string }[] = [];
      for (const dir of DATA_DIRS) {
        if (!(await adapter.exists(dir))) continue;
        const listed = (await adapter.list(dir)).files.filter((file) => file.endsWith('.jsonl'));
        files.push(
          ...(await Promise.all(listed.map(async (file) => ({ file, text: await adapter.read(file) })))),
        );
      }
      if (own !== null)
        for (const { file, text } of files) if (file.startsWith(own)) holdJournal(adapter, file, text);
      // One file order on every device: the OS does not guarantee the folder listing order.
      return mergeLegacy(files).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    },
  };
}
