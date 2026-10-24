// One append rule for all Buba journals: tags (`vault-io.ts`) and actions (`files/action-journal.ts`);
// journals are append-only. A line ends with a newline (POSIX definitions 3.206 and 3.195): a file that does
// not end with one was cut off mid-append, so the next record starts with a newline, otherwise it would merge
// with the fragment. The fragment stays a separate broken line that the journal parser skips and counts. Only
// types come from `obsidian`: the test substitutes an in-memory vault adapter.
import type { DataAdapter } from 'obsidian';

// Appends to one vault run one at a time: without a queue, two first appends at once would both see no file,
// and the second `write` would overwrite the first.
const queues = new WeakMap<object, Promise<unknown>>();

/**
 * File tails known in this session: `true` means the file ends with a newline. Learned only from what was
 * written: the file is never read, because `DataAdapter` has no partial read and a journal over ~512 MiB
 * cannot be read as one string (V8 string length limit). A tail unknown in the session counts as cut off, so
 * the session's first append to an existing file starts with a newline, like the record separator in RFC
 * 7464, §2.2. The cost is at most one empty line per file per session; the parser skips empty lines. Lives as
 * long as the adapter.
 */
const tails = new WeakMap<object, Map<string, boolean>>();

/**
 * Texts of own journals in this session, read or written, per adapter. Buba uses them to restore its own
 * journal if it disappears from disk: via the data folder guard (`data-dir.ts`) and on the first append after
 * the loss. Only own files of the new folder are held: tag journals are added by `readAll`, the action
 * journal by `readOwn`, the rest by appends.
 */
const held = new WeakMap<object, Map<string, string>>();

const heldOf = (adapter: object): Map<string, string> => {
  let map = held.get(adapter);
  if (!map) held.set(adapter, (map = new Map<string, string>()));
  return map;
};

/** Remembers an own journal's text as it is on disk. */
export function holdJournal(adapter: object, file: string, text: string): void {
  heldOf(adapter).set(file, text);
}

/** Texts of own journals this session has read or written. */
export function heldJournals(adapter: object): ReadonlyMap<string, string> {
  return heldOf(adapter);
}

/**
 * The vault's append queue; restoring the data folder runs in it too, so nothing slips between check and
 * write.
 */
export function serialJournal<T>(key: object, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(task);
  const settled = run.catch(() => undefined);
  queues.set(key, settled);
  return run;
}

/**
 * Appends `text` to the end of journal `file`, creating it if missing. Errors propagate and the file tail
 * becomes unknown again, since a failure may have left a fragment on disk. The adapter type has no `read`, so
 * the helper cannot read the file even by accident.
 */
export function appendJournal(
  adapter: Pick<DataAdapter, 'exists' | 'write' | 'append'>,
  file: string,
  text: string,
): Promise<string> {
  return serialJournal(adapter, async () => {
    let known = tails.get(adapter);
    if (!known) tails.set(adapter, (known = new Map<string, boolean>()));
    const exists = await adapter.exists(file);
    const memory = heldOf(adapter);
    // Own journal is in memory but gone from disk (data folder deleted, restore not done yet): write the old
    // text first, then the new lines, otherwise the disk would keep only the new line and lose the history.
    const before = exists ? undefined : memory.get(file);
    const clean = !exists || known.get(file) === true;
    const data =
      before !== undefined
        ? `${before}${before === '' || before.endsWith('\n') ? '' : '\n'}${text}`
        : clean
          ? text
          : `\n${text}`;
    known.delete(file);
    if (exists) await adapter.append(file, data);
    else await adapter.write(file, data);
    known.set(file, data === '' || data.endsWith('\n'));
    // Hold what is on disk: a new file in full, an appended one only if its text was already held.
    if (!exists) memory.set(file, data);
    else if (memory.has(file)) memory.set(file, memory.get(file) + data);
    return data;
  });
}
