// On-disk action journal: append-only, one file per device and month in `<data folder>/actions/`. Only types
// come from `obsidian`: the test substitutes an in-memory vault adapter.
import type { DataAdapter } from 'obsidian';
import {
  ACTIONS_DIR,
  actionsFile,
  canvasLine,
  lineSplitter,
  takeLine,
  type ActionLine,
  type Rejected,
} from '../../core/actions/journal.ts';
import { JOURNAL_DIR } from '../../core/storage/types.ts';
import { appendJournal, holdJournal } from '../storage/journal-append.ts';

/**
 * Own action journal is held in memory for restoring the data folder if, when read, it is no longer than this
 * many characters; a longer one is not held and does not come back after the folder is deleted.
 */
export const HOLD_ACTIONS_MAX = 16 * 1024 * 1024;

/**
 * What the journal takes from `app`: public vault adapter API only. No `read`: a journal over ~512 MiB cannot
 * be read as one string (V8 string length limit), so it is streamed from the file URL.
 */
type JournalApp = {
  vault: { adapter: Pick<DataAdapter, 'exists' | 'mkdir' | 'write' | 'append' | 'getResourcePath'> };
};

export interface ActionJournal {
  /** Appends lines to the device's file for the current month, creating the folder or file if missing. */
  append(lines: readonly ActionLine[]): Promise<void>;
  /**
   * Own device lines for the previous and current month, one by one into `each` while reading, never all in
   * memory; other devices' files are not read. Returns unknown and broken lines.
   */
  readOwn(each: (line: ActionLine) => void): Promise<Rejected>;
  /**
   * Records a canvas's previous text as one line before the write. Has the shape of the canvas adapter's
   * `CanvasJournal`.
   */
  recordCanvasWrite: (entry: { path: string; before: string }) => Promise<void>;
}

// Appends and reads of one vault run one at a time, even across journals: without a queue, the month's first
// two appends at once would both see no file, and the second `write` would overwrite the first.
const queues = new WeakMap<object, Promise<unknown>>();

function serial<T>(key: object, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(task);
  const settled = run.catch(() => undefined);
  queues.set(key, settled);
  return run;
}

/**
 * Journal of device `device`, whose id the caller passes. An id that would put records outside the journal
 * folder throws at once, before any write. `now` is the clock that picks the file's month and the canvas line
 * time.
 */
export function actionJournal(
  app: JournalApp,
  device: string,
  now: () => Date = () => new Date(),
): ActionJournal {
  const { adapter } = app.vault;
  actionsFile(device, now());

  const append = (lines: readonly ActionLine[]) =>
    serial(adapter, async () => {
      if (lines.length === 0) return;
      const file = actionsFile(device, now());
      const text = lines.map((line) => `${JSON.stringify(line)}\n`).join('');
      for (const dir of [JOURNAL_DIR, ACTIONS_DIR]) {
        if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
      }
      await appendJournal(adapter, file, text);
    });

  const readOwn = (each: (line: ActionLine) => void) =>
    serial(adapter, async () => {
      const at = now();
      const previous = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, 1));
      const rejected: Rejected = { unknown: [], broken: [] };
      const take = (raws: string[]) => {
        for (const raw of raws) takeLine(raw, each, rejected);
      };
      for (const file of [actionsFile(device, previous), actionsFile(device, at)]) {
        if (!(await adapter.exists(file))) continue;
        // Streamed from the file URL, like preview originals (`previews/store.ts`): only a chunk and a
        // partial line are in memory, not the file.
        const response = await window.fetch(adapter.getResourcePath(file), { cache: 'no-store' });
        if (!response.ok || !response.body) throw new Error(`reading log ${file}: ${response.status}`);
        const reader = response.body.getReader();
        // One splitter per file, so a cut-off end of last month's file does not merge with this month's first
        // line.
        const split = lineSplitter();
        // The file text, kept for restoring the data folder while it is no longer than HOLD_ACTIONS_MAX.
        const decoder = new TextDecoder();
        let text: string | null = '';
        try {
          for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
            take(split.push(chunk.value));
            if (text !== null) {
              text += decoder.decode(chunk.value, { stream: true });
              if (text.length > HOLD_ACTIONS_MAX) text = null;
            }
          }
        } catch (error) {
          await reader.cancel().catch(() => undefined);
          throw error;
        }
        take(split.end());
        if (text !== null) holdJournal(adapter, file, text + decoder.decode());
        else
          console.warn(
            `Buba: action log ${file} is longer than ${HOLD_ACTIONS_MAX} characters — not kept in memory; if the data ` +
              'folder is deleted, batch move history of past sessions will not come back',
          );
      }
      return rejected;
    });

  const recordCanvasWrite = (entry: { path: string; before: string }) =>
    append([canvasLine(entry, now().toISOString(), device)]);

  return { append, readOwn, recordCanvasWrite };
}
