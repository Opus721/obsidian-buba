// Undo and redo of Buba's own disk actions. One stack per `App`, in memory until restart or plugin unload;
// each device has its own. It is fed by renames (the tile menu dialog and file panel, `renameRecorded`) and
// by moves via drop on a tree folder (`recordMoves`). Undo and redo are the same batch moves as a drop
// (`moveOps`: plan to the action journal, "started", `renameFile`, "done"), after the core check: the same
// file is in place, the target is free, and a missing folder is created with `createFolder`. The check takes
// one pass per target folder, not one per move, so undoing a large batch does not freeze. The links dialog
// belongs to the caller (src/assets/actions/undo.ts). Deletion follows the Obsidian setting: the caller
// deletes with its own dialog (`promptForDeletion`, or `trashFile` after the "Delete files" dialog); this
// file finds where each file went (`trashSwept`), records the step (`deleteRecorded`), restores from
// Obsidian's trash (`restoreStep`) and says what can be deleted again (`trashReady`). Deletion and restore
// are not written to the action journal: `trashFile` and `adapter.rename` are each one atomic disk operation,
// with nothing to finish. A folder is deleted and restored the same way, as one item. Created files and
// folders are recorded with their trees (`recordCreated`); undoing that puts what is unchanged into the trash
// by the Obsidian setting (`uncreateStep`), and redo brings it back from Obsidian's trash (`recreateStep`).
// Changes Buba cannot undo yet are stops on the stack (`recordFixed`). Only types come from `obsidian`: the
// test substitutes a fake `app`.
import type { App, TAbstractFile } from 'obsidian';
import type { MoveOp } from '../../core/actions/journal.ts';
import {
  TRASH,
  UndoHistory,
  checkCreated,
  checkMoves,
  checkRestores,
  invert,
  lostWhere,
  matchTrash,
  restoreOrder,
  trashCandidate,
  trashOrigins,
  type CreateOp,
  type CreateStep,
  type CreateWhat,
  type CreatedUnchecked,
  type Disk,
  type FilePrint,
  type Made,
  type TrashPrint,
  type UncreateStep,
  type LocalTrashOp,
  type MovesStep,
  type Print,
  type Step,
  type StepOp,
  type TrashFailed,
  type TrashOp,
  type TrashOutcome,
  type TrashStep,
  type TrashUnchecked,
  type Unchecked,
} from '../../core/actions/undo.ts';
import { moveOps, type Failed } from './move.ts';
import { markOwnDelete, settleOwnDelete } from './own-deletes.ts';

const histories = new WeakMap<App, UndoHistory>();

/** The vault's undo stack, one per session, shared by all grids and windows. */
export function undoHistory(app: App): UndoHistory {
  let history = histories.get(app);
  if (!history) {
    history = new UndoHistory();
    histories.set(app, history);
  }
  return history;
}

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/**
 * Notes and canvases are rewritten by Obsidian itself when it updates links to moved files: a note inside
 * `renameFile` (`updateAllLinks`), a canvas 500 ms after it (the canvas's `requestProcessRename`), app.js
 * 1.14.4.
 */
const REWRITTEN_BY_OBSIDIAN = /\.(md|canvas)$/i;

/**
 * Fingerprint: size and modification time from `stat` for a file, plus the file object itself for notes and
 * canvases (core: `Print`), and `folder` for a folder.
 */
function printOf(file: TAbstractFile | null): Print | null {
  if (!file) return null;
  if ('stat' in file) {
    const { size, mtime } = (file as { stat: { size: number; mtime: number } }).stat;
    return REWRITTEN_BY_OBSIDIAN.test(file.path) ? { size, mtime, file } : { size, mtime };
  }
  return 'children' in file ? 'folder' : null;
}

/**
 * Disk view for one check, from Obsidian's vault tree: whether a name is taken is checked against folder
 * siblings, case-insensitively. Each folder is read once into a "lowercase path → paths" map; the view lives
 * for one check, until the first move.
 */
function vaultDisk(app: App): Disk {
  const { vault } = app;
  const folders = new Map<string, Map<string, string[]>>();
  const namesIn = (parent: string): Map<string, string[]> => {
    let names = folders.get(parent);
    if (!names) {
      names = new Map();
      const folder = parent ? vault.getFolderByPath(parent) : vault.getRoot();
      for (const { path } of folder?.children ?? []) {
        const key = path.toLowerCase();
        const same = names.get(key);
        if (same) same.push(path);
        else names.set(key, [path]);
      }
      folders.set(parent, names);
    }
    return names;
  };
  return {
    print: (path) => printOf(vault.getAbstractFileByPath(path)),
    holders: (path) => namesIn(parentOf(path)).get(path.toLowerCase()) ?? [],
  };
}

/**
 * Renames via `fileManager.renameFile` (Obsidian updates links) and records an undo step. On failure it
 * throws the same error as `renameFile`, and no step is recorded.
 */
export async function renameRecorded(app: App, file: TAbstractFile, to: string): Promise<void> {
  const from = file.path;
  await app.fileManager.renameFile(file, to);
  const print = printOf(file);
  if (print && file.path !== from)
    undoHistory(app).push({ kind: 'rename', ops: [{ from, to: file.path, print }] });
}

/** Records the step of a move by drop onto folder `folder`: `moved` is what `moveFiles` moved. */
export function recordMoves(app: App, moved: readonly MoveOp[], folder: string): void {
  const ops: StepOp[] = [];
  for (const { from, to } of moved) {
    const print = printOf(app.vault.getAbstractFileByPath(to));
    if (print) ops.push({ from, to, print });
  }
  undoHistory(app).push({ kind: 'move', folder, ops });
}

/**
 * Result of undoing or redoing a step. `step` is what was done, in the direction of the original action: an
 * undone step goes to redo, a redone one to undo. `skipped` failed the check, `failed` had `renameFile`
 * refuse; both are in the direction of the moves just made.
 */
export type StepRun = { step: Step; done: number; skipped: Unchecked[]; failed: Failed[] };

/**
 * Undoes a step: moves become reverse moves in reverse order; a deletion becomes a restore from Obsidian's
 * trash (`restoreStep`; `kept` tells whether a path has Buba records). The stack itself is left to the
 * caller.
 */
export function undoStep(app: App, step: MovesStep): Promise<StepRun>;
export function undoStep(
  app: App,
  step: MovesStep | TrashStep,
  kept?: (path: string) => boolean,
): Promise<StepRun | TrashUndo>;
export async function undoStep(
  app: App,
  step: MovesStep | TrashStep,
  kept?: (path: string) => boolean,
): Promise<StepRun | TrashUndo> {
  if (step.kind === 'trash') return restoreStep(app, step, kept);
  const run = await perform(app, invert(step.ops));
  return {
    step: { ...step, ops: invert(run.done) },
    done: run.done.length,
    skipped: run.skipped,
    failed: run.failed,
  };
}

/** Redoes an undone step: the same moves forward, with the same check. */
export async function redoStep(app: App, step: MovesStep): Promise<StepRun> {
  const run = await perform(app, step.ops);
  return {
    step: { ...step, ops: run.done },
    done: run.done.length,
    skipped: run.skipped,
    failed: run.failed,
  };
}

const pairOf = ({ from, to }: MoveOp): string => `${from}\0${to}`;

/**
 * Check → missing target folders → batch moves with the journal; done ops are found via a set of pairs, no
 * scanning.
 */
async function perform(app: App, ops: readonly StepOp[]) {
  const { ops: ready, skipped } = checkMoves(ops, vaultDisk(app));
  for (const folder of new Set(ready.map(({ to }) => parentOf(to)))) await ensureFolder(app, folder);
  const { moved, failed } = await moveOps(
    app,
    ready.map(({ from, to }) => ({ from, to })),
  );
  const pairs = new Set(moved.map(pairOf));
  const done = ready.filter((op) => pairs.has(pairOf(op)));
  return { done, skipped, failed };
}

/**
 * Creates a missing target folder (deleted after the move). `createFolder` fails with "Folder already
 * exists.", so `getFolderByPath` comes first. If creation fails, the move fails by itself and lands in
 * `failed` with the reason.
 */
async function ensureFolder(app: App, folder: string): Promise<void> {
  if (!folder || app.vault.getFolderByPath(folder)) return;
  try {
    await app.vault.createFolder(folder);
  } catch (error) {
    console.error('Buba: folder for undo not created', folder, error);
  }
}

// Deletion

/**
 * How long to wait for Obsidian to see a file restored from `.trash`: the file is announced by the folder
 * watcher, not by `adapter.rename` (a source in a hidden folder has no adapter record, app.js 1.14.4), and
 * Windows may drop events in a thousand moves in a row. If it is not seen, a notice asks to restart.
 */
export const SEEN_WAIT_MS = 2000;

const lower = (path: string): string => path.toLowerCase();
const statPrint = ({ size, mtime }: { size: number; mtime: number }): FilePrint => ({ size, mtime });
const samePrint = (a: FilePrint, b: FilePrint): boolean => a.size === b.size && a.mtime === b.mtime;
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * `.trash` entries via one `list`; empty if there is no folder. The check never blocks the deletion itself: a
 * read failure gives an empty list, and a file not found goes into the notice rather than failing.
 */
async function trashEntries(app: App): Promise<string[]> {
  try {
    const { adapter } = app.vault;
    if (!(await adapter.exists(TRASH))) return [];
    const { files, folders } = await adapter.list(TRASH);
    return [...files, ...folders];
  } catch (error) {
    console.error('Buba: Obsidian trash not read', error);
    return [];
  }
}

/**
 * Size and time of the file at a path via `adapter.stat`, since a file in `.trash` has no `TFile`; `null`
 * otherwise.
 */
async function printAt(app: App, path: string): Promise<TrashPrint | null> {
  try {
    const stat = await app.vault.adapter.stat(path);
    if (stat?.type === 'folder') return 'folder';
    return stat?.type === 'file' ? statPrint(stat) : null;
  } catch (error) {
    console.error('Buba: file in Obsidian trash not read', path, error);
    return null;
  }
}

/** Deletes with Obsidian's dialog, as its file explorer does: `false` means the dialog was closed. */
export const viaPrompt =
  (app: App) =>
  (file: TAbstractFile): Promise<boolean> =>
    app.fileManager.promptForDeletion(file);

/** Deletes without a dialog of its own (already confirmed); where it goes is up to the Obsidian setting. */
export const viaTrashFile =
  (app: App) =>
  async (file: TAbstractFile): Promise<boolean> => {
    await app.fileManager.trashFile(file);
    return true;
  };

/** Deletion result: deleted files in order and where each went; `failed` means Obsidian refused. */
export type TrashRun = { ops: TrashOp[]; failed: TrashFailed[] };

/**
 * Deletes `files` one by one via `remove` (Obsidian's `promptForDeletion` dialog or `trashFile`) and finds
 * where each went. `option` is Obsidian's "Deleted files" setting (`trashOption`, read by the caller). Before
 * the batch, one `list` of Obsidian's trash (skipped for "permanently delete"); after it, a `stat` of the
 * path where Obsidian would put the file (`trashCandidate`, the `trashLocal` rule): same size and time means
 * the file is there. If that fails with "Obsidian trash" or an unreadable setting, one `list` after the batch
 * and new entries with the same name (`matchTrash`, ties by ascending number). Not found means `lostWhere`.
 * If the system trash fails, Obsidian puts the file into `.trash` by the same rule, and the same `stat` finds
 * it. When `remove` returns `false` (dialog closed) the file is not in the result; when it throws it goes to
 * `failed` and the batch continues.
 */
export async function trashSwept(
  app: App,
  files: readonly TAbstractFile[],
  option: unknown,
  remove: (file: TAbstractFile) => Promise<boolean>,
): Promise<TrashRun> {
  const toTrash = option !== 'none';
  const taken = new Set((toTrash ? await trashEntries(app) : []).map(lower));
  const gone: { from: string; name: string; print: TrashPrint }[] = [];
  const failed: TrashFailed[] = [];
  for (const file of files) {
    const { path: from, name } = file;
    const print: TrashPrint = isFile(file) ? statPrint(file.stat) : 'folder';
    // A folder's files are marked too: the vault reports each of them deleted.
    const marked = [from, ...filesIn(file).map(({ path }) => path)];
    for (const path of marked) markOwnDelete(path);
    let deleted = false;
    try {
      deleted = await remove(file);
    } catch (error) {
      console.error('Buba: file not deleted', from, error);
      failed.push({ from, error: errorText(error) });
    }
    for (const path of marked) settleOwnDelete(path, deleted);
    if (deleted) gone.push({ from, name, print });
  }
  const found: (string | null)[] = gone.map(() => null);
  if (toTrash) {
    // Fingerprints of `.trash` paths already read, so the fallback check does not read them again.
    const known = new Map<string, TrashPrint | null>();
    for (const [i, { name, print }] of gone.entries()) {
      const expected = trashCandidate(name, taken);
      const there = await printAt(app, expected);
      known.set(lower(expected), there);
      if (there && sameTrashPrint(there, print)) {
        found[i] = expected;
        taken.add(lower(expected));
      }
    }
    const lost = gone.flatMap((each, i) => (found[i] ? [] : [{ i, ...each }]));
    if (lost.length && option !== 'system') {
      const names = new Set(lost.map(({ name }) => lower(name)));
      const prints = new Map<string, TrashPrint>();
      for (const path of await trashEntries(app)) {
        if (taken.has(lower(path)) || !trashOrigins(path).some(({ name }) => names.has(name))) continue;
        const there = known.has(lower(path)) ? known.get(lower(path)) : await printAt(app, path);
        if (there) prints.set(path, there);
      }
      matchTrash(lost, prints).forEach((path, k) => {
        const at = lost[k];
        if (path && at) found[at.i] = path;
      });
    }
  }
  const away = lostWhere(option);
  return {
    ops: gone.map(({ from, print }, i): TrashOp => {
      const to = found[i];
      return to ? { from, to, print, where: 'local' } : { from, to: '', print, where: away };
    }),
    failed,
  };
}

/** Deletes (`trashSwept`) and records an undo step for the deletion; no step if nothing was deleted. */
export async function deleteRecorded(
  app: App,
  files: readonly TAbstractFile[],
  option: unknown,
  remove: (file: TAbstractFile) => Promise<boolean>,
): Promise<TrashRun> {
  const run = await trashSwept(app, files, option, remove);
  undoHistory(app).push({ kind: 'trash', ops: run.ops });
  return run;
}

/** Result of undoing a deletion; `step` is what was restored, and it goes to redo. */
export type TrashUndo = TrashOutcome & { step: TrashStep };

/**
 * Undoes a deletion step: files from Obsidian's trash are moved with `vault.adapter.rename` from `.trash`
 * back to their old path (a file in `.trash` has no `TFile`, so `renameFile` cannot take it; there is no
 * overwrite, `rename` fails with "Destination file already exists!"), in reverse order, after the core check:
 * the same file is in `.trash` at the step's path (`adapter.stat`) and the old place is free; a missing
 * folder is created with `createFolder`. System trash, permanent deletion and files not found are left alone
 * (`elsewhere`). Then it waits for `vault.on('create')` of the restored paths up to `SEEN_WAIT_MS`. Tags come
 * back by themselves since storage records are tied to the path (`fileAppeared`). `kept` tells whether a path
 * has Buba records (`keptIn` of the plugin's storage): a copy without records whose twin in the step has
 * records is restored only after Obsidian has seen the twin (`restoreOrder`); otherwise storage would pair it
 * with the twin's disappearance and move the twin's tags onto it.
 */
export async function restoreStep(
  app: App,
  step: TrashStep,
  kept: (path: string) => boolean = () => false,
): Promise<TrashUndo> {
  const ops = [...step.ops].reverse();
  const inTrash = new Map<string, TrashPrint | null>();
  for (const op of ops) if (op.where === 'local') inTrash.set(op.to, await printAt(app, op.to));
  const checked = checkRestores(ops, vaultDisk(app), (path) => inTrash.get(path) ?? null);
  const { first, awaited, later } = restoreOrder(checked.ops, kept);
  const done = new Set<TrashOp>();
  const failed: TrashFailed[] = [];
  const back = async (list: readonly LocalTrashOp[]): Promise<void> => {
    for (const op of list) {
      try {
        await app.vault.adapter.rename(op.to, op.from);
        done.add(op);
      } catch (error) {
        console.error('Buba: file not restored from Obsidian trash', op.from, error);
        failed.push({ from: op.from, error: errorText(error) });
      }
    }
  };
  const watch = watchCreated(app);
  let unseen = 0;
  try {
    for (const folder of new Set(checked.ops.map(({ from }) => parentOf(from))))
      await ensureFolder(app, folder);
    await back(first);
    if (later.length) {
      // If the twin is not seen within `SEEN_WAIT_MS`, restore the copy anyway: the file on disk matters
      // more; it ends up as "not seen".
      await watch.missing(
        awaited.filter((op) => done.has(op)).map(({ from }) => from),
        SEEN_WAIT_MS,
      );
      await back(later);
    }
    unseen = (
      await watch.missing(
        [...done].map(({ from }) => from),
        SEEN_WAIT_MS,
      )
    ).length;
  } finally {
    watch.stop();
  }
  return {
    // Redo gets the deletion order, whatever the restore order was.
    step: { kind: 'trash', ops: step.ops.filter((op) => done.has(op)) },
    done: done.size,
    skipped: checked.skipped,
    failed,
    elsewhere: checked.elsewhere.reverse(),
    unseen,
  };
}

/** Listens to `vault.on('create')` from now on: which paths Obsidian has seen. */
function watchCreated(app: App) {
  const seen = new Set<string>();
  let wake = (_path: string): void => {};
  const ref = app.vault.on('create', (file) => {
    seen.add(file.path);
    wake(file.path);
  });
  return {
    stop: (): void => app.vault.offref(ref),
    /** Paths Obsidian has not seen within `ms`: neither a `create` event nor a file in the vault. */
    async missing(paths: readonly string[], ms: number): Promise<string[]> {
      const rest = new Set(paths.filter((path) => !seen.has(path) && !app.vault.getAbstractFileByPath(path)));
      if (rest.size) {
        await new Promise<void>((done) => {
          const timer = window.setTimeout(done, ms);
          wake = (path) => {
            rest.delete(path);
            if (rest.size) return;
            window.clearTimeout(timer);
            done();
          };
        });
        wake = () => {};
      }
      return [...rest].filter((path) => !app.vault.getAbstractFileByPath(path));
    },
  };
}

type FileLike = TAbstractFile & { stat: { size: number; mtime: number } };

/** A file, not a folder: only files carry `stat`. */
const isFile = (item: TAbstractFile | null): item is FileLike => item !== null && 'stat' in item;

/** Children of a folder; none for a file. */
const childrenOf = (item: TAbstractFile): readonly TAbstractFile[] =>
  (item as { children?: TAbstractFile[] }).children ?? [];

/** All files inside a folder, at any depth; none for a file. */
export function filesIn(item: TAbstractFile): FileLike[] {
  return childrenOf(item).flatMap((child) => (isFile(child) ? [child] : filesIn(child)));
}

/**
 * Redo of a deletion: which of the step's files are at their old place as the same file (size and time), and
 * which folders are back in place; those are deleted again, a different file or a file where a folder was is
 * "file changed", none is "file missing". Confirmation and deletion are up to the caller.
 */
export function trashReady(app: App, step: TrashStep): { files: TAbstractFile[]; skipped: TrashUnchecked[] } {
  const files: TAbstractFile[] = [];
  const skipped: TrashUnchecked[] = [];
  for (const op of step.ops) {
    const file = app.vault.getAbstractFileByPath(op.from);
    const print: TrashPrint | null = isFile(file) ? statPrint(file.stat) : file ? 'folder' : null;
    if (!print || !file) skipped.push({ op, why: 'missing' });
    else if (!sameTrashPrint(print, op.print)) skipped.push({ op, why: 'changed' });
    else files.push(file);
  }
  return { files, skipped };
}

const sameTrashPrint = (a: TrashPrint, b: TrashPrint): boolean =>
  a === 'folder' || b === 'folder' ? a === b : samePrint(a, b);

// Creating

/**
 * The tree at a path as it is now, the item first, then everything inside a folder: object and size. `null`
 * if nothing is there.
 */
function treeAt(app: App, path: string): Made[] | null {
  const item = app.vault.getAbstractFileByPath(path);
  if (!item) return null;
  const tree: Made[] = [];
  const walk = (each: TAbstractFile): void => {
    tree.push({ path: each.path, item: each, size: isFile(each) ? each.stat.size : null });
    for (const child of childrenOf(each)) walk(child);
  };
  walk(item);
  return tree;
}

/**
 * Records a create step: `paths` are what the action made in folder `place` (its name as shown), each with
 * its tree as it is now. Paths Obsidian does not see are left out; nothing seen, no step.
 */
export function recordCreated(app: App, what: CreateWhat, place: string, paths: readonly string[]): void {
  const ops: CreateOp[] = [];
  for (const path of paths) {
    const tree = treeAt(app, path);
    if (tree) ops.push({ path, tree });
  }
  undoHistory(app).push({ kind: 'create', what, place, ops });
}

/** Records a change Buba cannot undo yet: a stop on the undo stack. */
export function recordFixed(app: App): void {
  undoHistory(app).push({ kind: 'fixed', ops: [] });
}

/** Result of undoing a create step: `step` is what went to the trash, for redo. */
export type UncreateRun = {
  step: UncreateStep;
  done: number;
  skipped: CreatedUnchecked[];
  failed: TrashFailed[];
};

/**
 * Undoes a create step: what is still as Buba made it (`checkCreated`) is deleted with `trashFile` by the
 * Obsidian "Deleted files" setting, in reverse order; a changed or missing item stays and is named in the
 * notice. `option` is that setting, read by the caller.
 */
export async function uncreateStep(app: App, step: CreateStep, option: unknown): Promise<UncreateRun> {
  const checked = checkCreated([...step.ops].reverse(), (path) => treeAt(app, path));
  const items = checked.ops
    .map(({ path }) => app.vault.getAbstractFileByPath(path))
    .filter((item): item is TAbstractFile => item !== null);
  const run = await trashSwept(app, items, option, viaTrashFile(app));
  return {
    step: { kind: 'uncreate', what: step.what, place: step.place, ops: run.ops },
    done: run.ops.length,
    skipped: checked.skipped,
    failed: run.failed,
  };
}

/** Result of redoing a create step: the restore outcome and the create step to undo again. */
export type RecreateRun = TrashOutcome & { step: CreateStep };

/**
 * Redoes an undone create step: brings its items back from Obsidian's trash (`restoreStep`, same checks)
 * and records them again with their trees as they are now.
 */
export async function recreateStep(
  app: App,
  step: UncreateStep,
  kept?: (path: string) => boolean,
): Promise<RecreateRun> {
  const run = await restoreStep(app, { kind: 'trash', ops: step.ops }, kept);
  const ops: CreateOp[] = [];
  // The trash step is in deletion order, the reverse of creation.
  for (const { from } of [...run.step.ops].reverse()) {
    const tree = treeAt(app, from);
    if (tree) ops.push({ path: from, tree });
  }
  return { ...run, step: { kind: 'create', what: step.what, place: step.place, ops } };
}
