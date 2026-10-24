// Writes files from the system file manager, the clipboard and the file picker into the vault: only
// `vault.createBinary` of a new file and `vault.appendBinary` into that same file, only inside the vault, and
// never overwriting an existing file.
import type { App, TFile } from 'obsidian';
import {
  attachmentName,
  availablePath,
  pastedImageName,
  safeFileName,
} from '../../core/actions/import-names.ts';
import { t } from '../../core/i18n/dict/platform.ts';

/**
 * A file from an event: its own name, or `null` for a nameless clipboard image, which the write names
 * ("Pasted image …"). A `Blob` is read only when written, so a batch of large videos never sits in memory at
 * once.
 */
export interface ImportItem {
  name: string | null;
  type: string;
  data: ArrayBuffer | Blob;
}

/** What was not taken and why; the name is rendered as text only. */
export interface ImportRefusal {
  name: string;
  reason: string;
}

/** The event's files and refusals before writing. */
export interface EventFiles {
  items: ImportItem[];
  refused: ImportRefusal[];
}

/** Write result: created paths from the vault root, and refusals. */
export interface ImportResult {
  created: string[];
  refused: ImportRefusal[];
}

/**
 * Write chunk for large files, in bytes: a `Blob` larger than this is written in chunks (the first via
 * `createBinary`, the rest via `appendBinary`), so only a chunk is in memory, not the whole video. It is
 * below the threshold of Obsidian 1.13.7's mobile adapter (`writeBinaryInternal`: up to 5,242,880 bytes in
 * one call), so each chunk crosses the bridge in one call.
 */
export const CHUNK_BYTES = 4 * 1024 * 1024;

/** Obsidian's attachment folder with no open file: the vault root for "Same folder as current file". */
export const VAULT_ATTACHMENTS: unique symbol = Symbol('attachment folder without an open file');

/**
 * Where new files go: a folder path from the vault root (`'/'` for the root); `null` for where Obsidian puts
 * attachments of the open file ("All files"); `VAULT_ATTACHMENTS` for the attachment folder with no open file
 * (another module's source is open and has no folder).
 */
export type ImportFolder = string | null | typeof VAULT_ATTACHMENTS;

/**
 * Second argument of `getAvailablePathForAttachment` for `VAULT_ATTACHMENTS`: a path that is not a note.
 * Obsidian 1.13.7 and 1.14.4 take a note from it only if a file is there; otherwise there is no open file, so
 * "Same folder as current file" gives the root, `./folder` gives that folder from the root, and anything else
 * the configured folder (app.js, `getAvailablePathForAttachment(s)`). Without the second argument the last
 * opened file is used (obsidian.d.ts, `getActiveFile`). obsidian.d.ts does not document the folder behavior.
 */
const NOT_A_NOTE = '/';

/** How long to wait for an appended file's `TFile.stat` to show all its bytes, ms. */
export const STAT_WAIT_MS = 5_000;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Writes to one vault run one at a time: picking a free path and `createBinary` are one step. Without a
// queue, two drops or pastes of same-named files at once picked the same name (a file enters the index only
// after the write), and the second either overwrote the first (`createBinary` in 1.13.7 checks and writes
// with two adapter calls, so creation is not exclusive) or got "File already exists.". A failed step does not
// stop the queue. Same pattern as `serial` in `storage/journal-append.ts`.
const queues = new WeakMap<object, Promise<unknown>>();

function serial<T>(key: object, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(task);
  const settled = run.catch(() => undefined);
  queues.set(key, settled);
  return run;
}

/**
 * Files of an event (dropped or pasted) with their file system entry (`webkitGetAsEntry`): files and folders
 * from disk have one, clipboard data does not. Without an `items` list, only `files`.
 */
function eventFiles(data: DataTransfer): { file: File | null; entry: FileSystemEntry | null }[] {
  const items = Array.from(data.items ?? []).filter((item) => item.kind === 'file');
  if (!items.length) return Array.from(data.files, (file) => ({ file, entry: null }));
  return items.map((item) => ({ file: item.getAsFile(), entry: item.webkitGetAsEntry?.() ?? null }));
}

/** A nameless clipboard image, i.e. a screenshot: Chromium names it `image.png`. */
const unnamedImage = (file: File) =>
  pastedImageName(new Date(), file.type) !== null && (file.name === '' || /^image\.\w+$/i.test(file.name));

function readEvent(data: DataTransfer, pasted: boolean): EventFiles {
  const result: EventFiles = { items: [], refused: [] };
  for (const { file, entry } of eventFiles(data)) {
    if (entry?.isDirectory) {
      result.refused.push({ name: entry.name, reason: t('importFolder') });
    } else if (file) {
      const name = pasted && !entry && unnamedImage(file) ? null : file.name;
      result.items.push({ name, type: file.type, data: file });
    }
  }
  return result;
}

/**
 * Files dropped from the system file manager, under their own names; a folder is refused. Call in the `drop`
 * handler: after it `DataTransfer` is empty.
 */
export function readDropped(dataTransfer: DataTransfer): EventFiles {
  return readEvent(dataTransfer, false);
}

/**
 * Clipboard files, as Obsidian handles them: files copied in the file manager keep their names and any type;
 * a nameless image (screenshot) gets name `null` and the write names it "Pasted image …"; a folder is
 * refused. Call in the `paste` handler.
 */
export function readPasted(clipboardData: DataTransfer): EventFiles {
  return readEvent(clipboardData, true);
}

/**
 * A free path in a vault folder; a name differing only in case counts as taken, since Windows disks ignore
 * case.
 */
function freePathIn(app: App, folder: string, name: string, written: ReadonlySet<string>): string {
  const dir = folder.replace(/\/+$/, '');
  const target = dir ? app.vault.getFolderByPath(dir) : app.vault.getRoot();
  if (!target) throw new Error(t('importNoFolder', { folder }));
  const taken = new Set(target.children.map((child) => child.path.toLowerCase()));
  return availablePath(dir, name, (path) => taken.has(path.toLowerCase()) || written.has(path.toLowerCase()));
}

/**
 * Where a new file goes: into the open folder, with a number on a name clash as Obsidian does; for "All
 * files" (`folder = null`) where Obsidian puts attachments of the open file; for `VAULT_ATTACHMENTS` into the
 * attachment folder with no open file. `written` holds paths already written by this batch, in lowercase.
 */
export async function targetPath(
  app: App,
  folder: ImportFolder,
  name: string,
  written: ReadonlySet<string> = new Set(),
): Promise<string> {
  if (typeof folder === 'string') return freePathIn(app, folder, name, written);
  // A base name Obsidian would strip entirely (`#.png`) is renamed to "Untitled" up front; the extension
  // stays.
  const attachment = attachmentName(name);
  const suggested = await (folder === VAULT_ATTACHMENTS
    ? app.fileManager.getAvailablePathForAttachment(attachment, NOT_A_NOTE)
    : app.fileManager.getAvailablePathForAttachment(attachment));
  const slash = suggested.lastIndexOf('/');
  // Obsidian cleans the attachment name itself: `# ^ | :`, `[[`, `]]` become spaces and the ends are trimmed.
  // That turns `#.tar.gz` into a hidden `.tar.gz` and `CON#.png` into the device name `CON.png`, so the name
  // goes through `safeFileName` again.
  const cleaned = safeFileName(suggested.slice(slash + 1));
  return freePathIn(app, slash === -1 ? '/' : suggested.slice(0, slash), cleaned, written);
}

/** A write refusal with a reason; the name is rendered as text only. */
class Refused extends Error {}

/** Reads a `Blob` slice; a read error becomes a "not read" refusal. */
async function readSlice(blob: Blob, start: number, end: number): Promise<ArrayBuffer> {
  try {
    return await blob.slice(start, end).arrayBuffer();
  } catch (error) {
    throw new Refused(t('importNotRead', { error: message(error) }));
  }
}

/**
 * Appends the rest of a `Blob` to a just-created file in `CHUNK_BYTES` chunks. On failure the partial file is
 * removed with `vault.delete` (it is ours, created by this write) and the refusal states the reason.
 */
async function appendRest(app: App, file: TFile, blob: Blob): Promise<void> {
  try {
    for (let start = CHUNK_BYTES; start < blob.size; start += CHUNK_BYTES) {
      const chunk = await readSlice(blob, start, Math.min(start + CHUNK_BYTES, blob.size));
      await app.vault.appendBinary(file, chunk);
    }
  } catch (error) {
    const reason =
      error instanceof Refused ? error.message : t('importNotWritten', { error: message(error) });
    try {
      await app.vault.delete(file);
    } catch (removal) {
      throw new Refused(t('importPartialKept', { reason, path: file.path, error: message(removal) }));
    }
    throw new Refused(t('importPartialRemoved', { reason }));
  }
}

/**
 * Waits until `TFile.stat` of a file appended in chunks shows all `size` bytes: the first tag writes the
 * `file.seen` fingerprint from it, and a first-chunk fingerprint would not recognize the file after a move in
 * the file manager. `Vault.appendBinary` does not touch `stat` itself, but the desktop and phone adapters of
 * Obsidian 1.13.7 and 1.14.4 await `reconcileInternalFile` in the `finally` of their `appendBinary`: `stat`
 * from disk → `modified` → `TFile.stat` and the `modify` event, all before the call returns, so there is
 * usually nothing to wait for. Otherwise this waits for the file's `modify` event, at most `STAT_WAIT_MS`; if
 * it never comes, storage rewrites the fingerprint on `modify` (`fileChanged`) or in the startup check.
 */
function statShows(app: App, file: TFile, size: number): Promise<void> {
  return new Promise((resolve) => {
    const ref = app.vault.on('modify', (changed) => {
      if (changed.path === file.path && file.stat.size === size) done();
    });
    const timer = setTimeout(done, STAT_WAIT_MS);
    function done(): void {
      app.vault.offref(ref);
      clearTimeout(timer);
      resolve();
    }
    if (file.stat.size === size) done();
  });
}

/**
 * Writes files into the open folder (`folder` is a path from the vault root, `'/'` for the root), for "All
 * files" (`null`) where Obsidian puts attachments, for `VAULT_ATTACHMENTS` into the attachment folder with no
 * open file. Names go through `safeFileName`; a nameless image becomes "Pasted image …". Each file is written
 * with `vault.createBinary`, and picking the path plus writing is one step of the vault queue, so concurrent
 * calls never share a name. A `Blob` larger than `CHUNK_BYTES` writes its first chunk in the queue step and
 * the rest with `appendBinary` after it. `created` holds the `TFile` path returned by the write: Obsidian
 * normalizes the path itself and returns `null` for a write that is not in the vault, which is a refusal. A
 * chunked file's path is returned once `TFile.stat` shows all its bytes (`statShows`; all such files of a
 * batch wait together). One file's refusal does not stop the others. `onItem` runs before each file with its
 * 1-based number and the total, for progress.
 */
export async function importFiles(
  app: App,
  folder: ImportFolder,
  items: readonly ImportItem[],
  now: Date = new Date(),
  onItem?: (index: number, total: number) => void,
): Promise<ImportResult> {
  const result: ImportResult = { created: [], refused: [] };
  const written = new Set<string>();
  const sized: Promise<void>[] = [];
  for (const [index, item] of items.entries()) {
    onItem?.(index + 1, items.length);
    const name = item.name === null ? pastedImageName(now, item.type) : safeFileName(item.name);
    const shown = item.name ?? name ?? t('importPastedImage');
    if (name === null) {
      result.refused.push({ name: shown, reason: t('importUnnamedNotImage') });
      continue;
    }
    // A large `Blob` goes in chunks; other data has no chunk size and is read whole.
    const big = 'arrayBuffer' in item.data && item.data.size > CHUNK_BYTES ? item.data : null;
    let data: ArrayBuffer;
    try {
      if (big) data = await readSlice(big, 0, CHUNK_BYTES);
      else data = 'arrayBuffer' in item.data ? await item.data.arrayBuffer() : item.data;
    } catch (error) {
      const reason = error instanceof Refused ? error.message : t('importNotRead', { error: message(error) });
      result.refused.push({ name: shown, reason });
      continue;
    }
    try {
      // The first chunk is read before the queue: the queue step only picks the path and writes.
      const created = await serial(app.vault, async () => {
        const path = await targetPath(app, folder, name, written);
        // Obsidian's types promise a `TFile`, but 1.13.7 returns `null` when the written file is not in the
        // vault.
        const file = (await app.vault.createBinary(path, data)) as TFile | null;
        written.add(path.toLowerCase());
        return file;
      });
      if (!created) {
        result.refused.push({ name: shown, reason: t('importNotInVault') });
        continue;
      }
      written.add(created.path.toLowerCase());
      // The first chunk has claimed the name: the rest goes outside the queue, so other writes do not wait
      // for it.
      if (big) {
        await appendRest(app, created, big);
        sized.push(statShows(app, created, big.size));
      }
      result.created.push(created.path);
    } catch (error) {
      const reason =
        error instanceof Refused ? error.message : t('importNotWritten', { error: message(error) });
      result.refused.push({ name: shown, reason });
    }
  }
  await Promise.all(sized);
  return result;
}
