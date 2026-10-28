// Undo and redo of Buba's own actions. Core rule, no `obsidian` import. The stack lives in memory, like the
// Obsidian canvas history (`history = new k7(100)`, app.js 1.14.4): 100 steps, a new action drops the redo
// stack. As in a file manager (Explorer, Finder, Eagle), every Buba action is a step, so Ctrl+Z always takes
// the last one: moving tiles by dropping them on a Buba tree folder, renaming, deleting files or folders,
// creating (pasted copies, "Make a copy", a new folder, note, canvas or base, added files). Changes of tags,
// ratings, comments and looks are steps too, but ones that cannot be undone (`FixedStep`): Ctrl+Z says so and
// stops there instead of quietly undoing an older action; the next press goes on. As in a file manager, the
// history lasts while Obsidian runs and an older step is undone without asking (word of the owner 27.10).
// Before undo and redo every move is checked against
// the disk: the same file is in place (size and modification time, or for notes and canvases the same file
// object) and the destination is free; someone else's file is never touched. Created files go to the trash
// only while they are as Buba made them (`checkCreated`). Deletion follows the Obsidian setting: a file comes
// back from the Obsidian trash (`.trash`), not from the system trash or after "permanently delete", and the
// notice says where it is. The moves and restores themselves are in src/platform/files/undo.ts.
import { t } from '../i18n/dict/actions.ts';
import type { BubaStorage, FileLinks } from '../storage/types.ts';
import type { MoveOp } from './journal.ts';

/** Stack depth, as in the Obsidian canvas. */
export const DEPTH = 100;

/**
 * What is at a path: a file gives size and modification time, a folder gives `folder`. `file` is the Obsidian
 * file object itself, for notes and canvases: Obsidian rewrites them on its own when it updates links to
 * moved files (`renameFile`), so size and time go stale; the object survives both the move and that write,
 * while another file at the same path is a different object.
 */
export type Print = { size: number; mtime: number; file?: object } | 'folder';
/** A move of a step: from and to in the direction of the action itself, and a print of what was moved. */
export type StepOp = MoveOp & { print: Print };

/** Moving tiles by dropping them on folder `folder` (root is `'/'`). */
export type MoveStep = { kind: 'move'; folder: string; ops: StepOp[] };
/** Renaming a file: one move within the same folder. */
export type RenameStep = { kind: 'rename'; ops: StepOp[] };
/** A step made of moves: undo and redo are `renameFile` moves. */
export type MovesStep = MoveStep | RenameStep;

/** Size and modification time: how Buba recognizes its deleted file in the Obsidian trash and old place. */
export type FilePrint = { size: number; mtime: number };
/** What a deleted item was: a file's print, or `folder` (a folder is recognized by its name and kind). */
export type TrashPrint = FilePrint | 'folder';
/**
 * Where a deleted file went, from Obsidian's "Files and links > Deleted files" setting (`trashOption`) and a
 * check of `.trash`: `local` is the Obsidian trash; `system` the system trash; `missing` means the setting
 * says Obsidian trash but the file is not in `.trash`; `forever` is "permanently delete"; `unknown` means not
 * in `.trash` and the setting cannot be read (Obsidian before 1.13.0).
 */
export type TrashWhere = 'local' | 'system' | 'missing' | 'forever' | 'unknown';
/**
 * A deleted file of a step, as a move into the trash: `from` is the old path, `to` the path in the Obsidian
 * trash (`.trash/frame 2.png`; empty if the file is not there), plus its print and where it went.
 */
export type TrashOp = MoveOp & { print: TrashPrint; where: TrashWhere };
/** Deleting files or folders: one with the Obsidian dialog or a batch with the "Delete files" dialog. */
export type TrashStep = { kind: 'trash'; ops: TrashOp[] };

/**
 * What a create step made: pasted copies (`copy`), "Make a copy" (`duplicate`), a new folder (`folder`), a
 * new note, canvas or base (`file`), files added from the computer (`import`).
 */
export type CreateWhat = 'copy' | 'duplicate' | 'folder' | 'file' | 'import';
/**
 * One item of a created thing as Buba made it: its path, the vault object itself (a file or folder object
 * lives while the item stays at its path, a new item at the path is another object) and a file's size
 * (`null` for a folder).
 */
export type Made = { path: string; item: object; size: number | null };
/** A created file or folder: its path and its whole tree as made, the item itself first. */
export type CreateOp = { path: string; tree: readonly Made[] };
/** Creating files or folders in `place` (the folder's name as shown, the vault name for the root). */
export type CreateStep = { kind: 'create'; what: CreateWhat; place: string; ops: CreateOp[] };
/** An undone create step on the redo stack: what went to the trash, to bring back on redo. */
export type UncreateStep = { kind: 'uncreate'; what: CreateWhat; place: string; ops: TrashOp[] };
/**
 * A change Buba cannot undo yet (tags, ratings, comments, looks of folders and tags): a stop on the undo
 * stack, so Ctrl+Z does not quietly undo an older action instead.
 */
export type FixedStep = { kind: 'fixed'; ops: readonly never[] };
export type Step = MovesStep | TrashStep | CreateStep | UncreateStep | FixedStep;

/** Why undo or redo skips a move: `missing` (no file), `changed` (file changed), `taken` (name taken). */
export type CheckReason = 'missing' | 'changed' | 'taken';
/** Reason in words, as a dictionary key: lines for undoing a move and for redo. */
const REDO_WHY = {
  missing: 'goneMissing',
  changed: 'goneChanged',
  taken: 'goneTaken',
} as const satisfies Record<CheckReason, string>;
export type Unchecked = { op: StepOp; why: CheckReason };
export type Checked = { ops: StepOp[]; skipped: Unchecked[] };

/** What the check knows about the disk. */
export interface Disk {
  /** Print of what is at the path; `null` if nothing. */
  print(path: string): Print | null;
  /**
   * Paths in the folder of `path` that hold its name ignoring case (the path itself too): Windows and
   * macOS disks ignore case.
   */
  holders(path: string): readonly string[];
}

/** What is there `now` matches `then`: same folder; same size and time; or the same file object, if kept. */
const samePrint = (now: Print | null, then: Print): boolean =>
  now === 'folder' || then === 'folder'
    ? now === then
    : now !== null &&
      ((now.size === then.size && now.mtime === then.mtime) ||
        (then.file !== undefined && now.file === then.file));

/**
 * Which of `ops` (in the direction they will be done) can be done now, in order: the same file is at `from`,
 * otherwise "missing" or "changed"; `to` is free, otherwise "taken". A path held only by the moved file
 * itself (a case-only rename) counts as free; a path claimed by an earlier move of the same batch counts as
 * taken. `disk` is a snapshot for one check: it reads a folder once.
 */
export function checkMoves(ops: readonly StepOp[], disk: Disk): Checked {
  const claimed = new Set<string>();
  const checked: Checked = { ops: [], skipped: [] };
  for (const op of ops) {
    const there = disk.print(op.from);
    const key = op.to.toLowerCase();
    const why: CheckReason | null =
      there === null
        ? 'missing'
        : !samePrint(there, op.print)
          ? 'changed'
          : claimed.has(key) || disk.holders(op.to).some((path) => path !== op.from)
            ? 'taken'
            : null;
    if (why) {
      checked.skipped.push({ op, why });
    } else {
      claimed.add(key);
      checked.ops.push(op);
    }
  }
  return checked;
}

/** Reverse moves: in reverse order, `to -> from`. */
export function invert(ops: readonly StepOp[]): StepOp[] {
  return ops.map(({ from, to, print }) => ({ from: to, to: from, print })).reverse();
}

/** Undo check: the reverse moves of a step that can be done now. */
export function reverseMoves(ops: readonly StepOp[], disk: Disk): Checked {
  return checkMoves(invert(ops), disk);
}

/**
 * Undo and redo stack. The step to undo is taken from the top (`takeUndo`), and only what was actually undone
 * goes to redo (`undone`); redo works the other way round. A new action (`push`) drops the redo stack; a step
 * without moves is not recorded, except a stop (`FixedStep`), and stops in a row are one; steps beyond 100
 * are dropped.
 */
export class UndoHistory {
  readonly #undo: Step[] = [];
  readonly #redo: Step[] = [];

  push(step: Step): void {
    if (step.kind === 'fixed') {
      if (this.#undo.at(-1)?.kind === 'fixed') this.#undo.pop();
    } else if (!step.ops.length) return;
    keep(this.#undo, step);
    this.#redo.length = 0;
  }

  peekUndo(): Step | null {
    return this.#undo.at(-1) ?? null;
  }

  peekRedo(): Step | null {
    return this.#redo.at(-1) ?? null;
  }

  /** Takes `step` off the undo stack top; if it is not on top, returns `false` and changes nothing. */
  takeUndo(step: Step): boolean {
    return take(this.#undo, step);
  }

  takeRedo(step: Step): boolean {
    return take(this.#redo, step);
  }

  /** What was undone goes to redo; if nothing was undone, the step is dropped. */
  undone(step: Step): void {
    if (step.ops.length) keep(this.#redo, step);
  }

  /** What was redone goes back to undo; redo is not cleared. */
  redone(step: Step): void {
    if (step.ops.length) keep(this.#undo, step);
  }
}

function keep(stack: Step[], step: Step): void {
  stack.push(step);
  if (stack.length > DEPTH) stack.shift();
}

function take(stack: Step[], step: Step): boolean {
  if (stack.at(-1) !== step) return false;
  stack.pop();
  return true;
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** Why undoing a create skips an item: `missing` (gone), `changed` (changed since Buba made it). */
export type CreatedUnchecked = { op: CreateOp; why: 'missing' | 'changed' };

/**
 * Which created items can go to the trash now: the same objects at the same paths, file sizes as made, and
 * nothing added inside a folder; otherwise "missing" (nothing at the path) or "changed". `treeAt` gives the
 * tree at a path now, the item first, or `null`.
 */
export function checkCreated(
  ops: readonly CreateOp[],
  treeAt: (path: string) => readonly Made[] | null,
): { ops: CreateOp[]; skipped: CreatedUnchecked[] } {
  const checked: { ops: CreateOp[]; skipped: CreatedUnchecked[] } = { ops: [], skipped: [] };
  for (const op of ops) {
    const now = treeAt(op.path);
    if (!now) checked.skipped.push({ op, why: 'missing' });
    else if (!sameTree(now, op.tree)) checked.skipped.push({ op, why: 'changed' });
    else checked.ops.push(op);
  }
  return checked;
}

function sameTree(now: readonly Made[], then: readonly Made[]): boolean {
  if (now.length !== then.length) return false;
  const made = new Map(then.map((each) => [each.path, each]));
  return now.every(({ path, item, size }) => {
    const was = made.get(path);
    return was !== undefined && was.item === item && was.size === size;
  });
}

/** Undo lines of a create step: "path — why", names as text only. */
export function createdLines(
  skipped: readonly CreatedUnchecked[],
  failed: readonly { from: string; error: string }[],
): string[] {
  return [
    ...skipped.map(({ op, why }) =>
      t('pathReason', { path: op.path, reason: t(why === 'missing' ? 'createdMissing' : 'createdChanged') }),
    ),
    ...failed.map(({ from, error }) => t('pathReason', { path: from, reason: error })),
  ];
}

/**
 * The step in words, for the notice and the menu item: "moving 3 files to "Done"", "renaming "a.png" to
 * "b.png"", "deleting "frame.png"", "deleting 3 files".
 */
export function stepTitle(step: Step): string {
  if (step.kind === 'fixed') return t('stepFixed');
  if (step.kind === 'create' || step.kind === 'uncreate') {
    const paths =
      step.kind === 'create' ? step.ops.map(({ path }) => path) : step.ops.map(({ from }) => from);
    const [only] = paths;
    const vars = { count: paths.length, place: step.place };
    if (paths.length === 1 && only)
      return t(CREATE_ONE[step.what], { name: nameOf(only), place: step.place });
    return t(CREATE_MANY[step.what], vars);
  }
  if (step.kind === 'trash') {
    const [op] = step.ops;
    if (step.ops.length === 1 && op) return t('stepTrashOne', { name: nameOf(op.from) });
    return step.ops.every(({ print }) => print === 'folder')
      ? t('stepTrashFolders', { count: step.ops.length })
      : t('stepTrashMany', { count: step.ops.length });
  }
  if (step.kind === 'rename') {
    const [op] = step.ops;
    return op ? t('stepRenameOne', { from: nameOf(op.from), to: nameOf(op.to) }) : t('stepRename');
  }
  const folder = step.folder.replace(/^\/+|\/+$/g, '');
  const count = step.ops.length;
  return folder ? t('stepMoveTo', { count, folder }) : t('stepMoveRoot', { count });
}

/** Create step titles by what was made: one item by name, more by count. */
const CREATE_ONE = {
  copy: 'stepPasteOne',
  duplicate: 'stepDuplicateOne',
  folder: 'stepNewFolder',
  file: 'stepNewFile',
  import: 'stepAddOne',
} as const satisfies Record<CreateWhat, string>;
const CREATE_MANY = {
  copy: 'stepPasteMany',
  duplicate: 'stepDuplicateMany',
  folder: 'stepNewFolders',
  file: 'stepNewFiles',
  import: 'stepAddMany',
} as const satisfies Record<CreateWhat, string>;

/** Hint when there is nothing to undo or redo: otherwise Ctrl+Z after a native explorer move looks broken. */
export function nothingTo(kind: 'undo' | 'redo'): string {
  return kind === 'undo' ? t('nothingToUndo') : t('nothingToRedo');
}

/** Result of undo or redo: what was not done and why, as moves in the direction they were made. */
export type RunOutcome = {
  done: number;
  skipped: readonly Unchecked[];
  failed: readonly (MoveOp & { error: string })[];
};

/** Reason lines: "path: why", names as text only. */
export function outcomeLines({ skipped, failed }: RunOutcome): string[] {
  return [
    ...skipped.map(({ op, why }) =>
      why === 'taken'
        ? t('pathTaken', { from: op.from, to: op.to })
        : t('pathReason', { path: op.from, reason: t(REDO_WHY[why]) }),
    ),
    ...failed.map(({ from, error }) => t('pathReason', { path: from, reason: error })),
  ];
}

/** First notice line: "Undone: …", or "Not undone: …" if nothing came back; the same for "Redone". */
export function outcomeHead(kind: 'undo' | 'redo', step: Step, outcome: { done: number }): string {
  const vars = { step: stepTitle(step) };
  if (kind === 'undo') return outcome.done ? t('undone', vars) : t('notUndone', vars);
  return outcome.done ? t('redone', vars) : t('notRedone', vars);
}

/** Line with the count of what was not done: "Not restored: 1 file", "Not redone: 2 files". */
export function missedLine(kind: 'undo' | 'redo', count: number): string {
  return kind === 'undo' ? t('missedUndo', { count }) : t('missedRedo', { count });
}

// Deletion. Buba learns where a file went by checking its own call, not by guessing: before the batch it
// records the names taken in `.trash`, after deletion it checks the path expected by Obsidian's rule plus
// size and time; if that does not confirm, it looks at new `.trash` entries with the same name. Only a file
// found in `.trash` at the recorded path as the same file is restored, and only to a free old place.

/** The Obsidian trash in the vault is a hidden folder; its files have no `TFile`. */
export const TRASH = '.trash';

/** Name and extension, split like `path.extname` in `trashLocal`: "a.tar.gz" gives "a.tar", ".gz". */
function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}

/**
 * Path under which Obsidian puts file `name` into the Obsidian trash, per the `trashLocal` rule (app.js
 * 1.14.4, desktop and mobile): "frame.png", if taken "frame 2.png", "frame 3.png"…; `taken` holds the taken
 * `.trash` paths in lower case, since Windows, macOS and iPhone disks ignore case.
 */
export function trashCandidate(name: string, taken: ReadonlySet<string>): string {
  const [base, ext] = splitName(name);
  let path = `${TRASH}/${base}${ext}`;
  for (let n = 2; taken.has(path.toLowerCase()); n += 1) path = `${TRASH}/${base} ${n}${ext}`;
  return path;
}

/**
 * Whose a `.trash` entry may be: "frame 3.png" is either file "frame 3.png" with number 1 or file "frame.png"
 * with number 3. Names are in lower case.
 */
export function trashOrigins(path: string): { name: string; n: number }[] {
  const entry = path.slice(path.lastIndexOf('/') + 1);
  const own = { name: entry.toLowerCase(), n: 1 };
  const [base, ext] = splitName(entry);
  const numbered = /^(.+) ([1-9]\d*)$/.exec(base);
  const n = numbered ? Number(numbered[2]) : 0;
  return numbered && n >= 2 ? [own, { name: `${numbered[1]}${ext}`.toLowerCase(), n }] : [own];
}

/** Same file by size and time, or both folders. */
const sameSizeAndDate = (a: TrashPrint, b: TrashPrint): boolean =>
  a === 'folder' || b === 'folder' ? a === b : a.size === b.size && a.mtime === b.mtime;

/**
 * Fallback check: which new `.trash` entry belongs to which deleted file when the expected path did not
 * confirm. `gone` are the deleted files in deletion order (name and print), `found` the new `.trash` entries
 * with their prints. A file gets an entry of its name ("frame.png" or "frame N.png", ignoring case) with the
 * same size and time; ties (identical files from different folders) go by ascending number, the way
 * `trashLocal` numbers them: the earlier deleted file gets the lower number. `null` if nothing matches.
 */
export function matchTrash(
  gone: readonly { name: string; print: TrashPrint }[],
  found: ReadonlyMap<string, TrashPrint>,
): (string | null)[] {
  const byName = new Map<string, { path: string; n: number; print: TrashPrint }[]>();
  for (const [path, print] of found) {
    for (const { name, n } of trashOrigins(path)) {
      const list = byName.get(name);
      if (list) list.push({ path, n, print });
      else byName.set(name, [{ path, n, print }]);
    }
  }
  for (const list of byName.values()) list.sort((a, b) => a.n - b.n);
  const claimed = new Set<string>();
  return gone.map(({ name, print }) => {
    const hit = byName
      .get(name.toLowerCase())
      ?.find((each) => !claimed.has(each.path) && sameSizeAndDate(each.print, print));
    if (!hit) return null;
    claimed.add(hit.path);
    return hit.path;
  });
}

/** Where a file missing from `.trash` went, by `trashOption`: `none`, `local`, `system`, else unreadable. */
export function lostWhere(option: unknown): TrashWhere {
  if (option === 'none') return 'forever';
  if (option === 'local') return 'missing';
  if (option === 'system') return 'system';
  return 'unknown';
}

/** A deleted file in the Obsidian trash: it can be restored. */
export type LocalTrashOp = TrashOp & { where: 'local' };
export type TrashUnchecked = { op: TrashOp; why: CheckReason };

/**
 * What from a delete step can be restored now, in order: the same file is in the Obsidian trash at the step's
 * path (`trashed` gives the print of what is at `to`, or `null`), otherwise "missing" or "changed"; the old
 * place is free ignoring case, including from an earlier restore of the same step, otherwise "taken".
 * `elsewhere` are files not in the Obsidian trash (system trash, permanently deleted, not found): Buba leaves
 * them alone and the notice tells about them.
 */
export function checkRestores(
  ops: readonly TrashOp[],
  disk: Disk,
  trashed: (path: string) => TrashPrint | null,
): { ops: LocalTrashOp[]; skipped: TrashUnchecked[]; elsewhere: TrashOp[] } {
  const claimed = new Set<string>();
  const checked: { ops: LocalTrashOp[]; skipped: TrashUnchecked[]; elsewhere: TrashOp[] } = {
    ops: [],
    skipped: [],
    elsewhere: [],
  };
  for (const op of ops) {
    if (op.where !== 'local') {
      checked.elsewhere.push(op);
      continue;
    }
    const there = trashed(op.to);
    const key = op.from.toLowerCase();
    const why: CheckReason | null =
      there === null
        ? 'missing'
        : !sameSizeAndDate(there, op.print)
          ? 'changed'
          : claimed.has(key) || disk.holders(op.from).length
            ? 'taken'
            : null;
    if (why) {
      checked.skipped.push({ op, why });
    } else {
      claimed.add(key);
      checked.ops.push(op as LocalTrashOp);
    }
  }
  return checked;
}

/** Plugin storage as the restore order reads it: path records, and a file's link if storage knows links. */
export type KeptStorage = Pick<BubaStorage, 'get'> & Partial<Pick<FileLinks, 'link'>>;

/**
 * Whether a path has Buba records, the same ones storage carries along on vault events (`hasRecords` in
 * src/core/storage/store.ts): tags, rating, comments and a file's link (`link.set`; a path with only a
 * link is still a record). No storage (the plugin has not loaded it yet) means no records; storage without
 * links means no links.
 */
export const keptIn =
  (storage: KeptStorage | undefined) =>
  (path: string): boolean => {
    if (!storage) return false;
    const { tags, rating, comments } = storage.get(path);
    return tags.length > 0 || rating > 0 || comments.length > 0 || (storage.link?.(path) ?? null) !== null;
  };

/** Twins for tag storage: same name, size and time, which is how move pairing matches a pair. */
const twinKey = ({ from, print }: TrashOp): string =>
  `${print === 'folder' ? print : `${print.size}:${print.mtime}`}:${from.slice(from.lastIndexOf('/') + 1)}`;

/**
 * Order of restoring from the Obsidian trash. Storage pairs the "gone" event of a file with records and the
 * "appeared" event of a file without records by print (name, size and time, within 2 s of the last event): a
 * copy without records that came back before its twin with records from the same step would take the twin's
 * records with a `file.move` line. `later` are such copies: they are restored once Obsidian has reported the
 * twins from `awaited` as back, because storage takes events in order and the twin's "appeared" at its own
 * path clears its "gone" before the copy arrives. `first` are the rest, in `ops` order, right away: without a
 * twin there is nothing to wait for.
 */
export function restoreOrder(
  ops: readonly LocalTrashOp[],
  kept: (path: string) => boolean,
): { first: LocalTrashOp[]; awaited: LocalTrashOp[]; later: LocalTrashOp[] } {
  const marked = new Set(ops.filter(({ from }) => kept(from)));
  const keys = new Set([...marked].map(twinKey));
  const later = new Set(ops.filter((op) => !marked.has(op) && keys.has(twinKey(op))));
  const waited = new Set([...later].map(twinKey));
  return {
    first: ops.filter((op) => !later.has(op)),
    awaited: [...marked].filter((op) => waited.has(twinKey(op))),
    later: [...later],
  };
}

/** Deleting or restoring a file failed: the path and the reason. */
export type TrashFailed = { from: string; error: string };
/**
 * Result of undoing or redoing a deletion: how many were done; `skipped` failed the check; `failed` Obsidian
 * refused; `elsewhere` not in the Obsidian trash; `unseen` restored to disk but not yet seen by Obsidian.
 */
export type TrashOutcome = {
  done: number;
  skipped: readonly TrashUnchecked[];
  failed: readonly TrashFailed[];
  elsewhere: readonly TrashOp[];
  unseen: number;
};

/** Where to look in the system trash: desktop Windows, macOS or other; iPhone and iPad use "Files". */
export type SystemTrash = 'windows' | 'mac' | 'ios' | 'other';
const SYSTEM_PLACE = {
  windows: 'placeWindows',
  mac: 'placeMac',
  ios: 'placeIos',
  other: 'placeOther',
} as const satisfies Record<SystemTrash, string>;

/** Why a file did not come back from the Obsidian trash, as a dictionary key. */
const UNDO_WHY = {
  missing: 'restoreMissing',
  changed: 'restoreChanged',
  taken: 'restoreTaken',
} as const satisfies Record<CheckReason, string>;

/** Lines about files outside the Obsidian trash: one as a sentence with its name, more as count and paths. */
function elsewhereLines(ops: readonly TrashOp[], system: SystemTrash): string[] {
  const of = (kind: TrashWhere) => ops.filter(({ where }) => where === kind);
  const group = (list: readonly TrashOp[], one: (op: TrashOp) => string, many: string): string[] => {
    const [first] = list;
    if (!first) return [];
    return list.length === 1
      ? [one(first)]
      : [many, ...list.map(({ from }) => t('quotedPath', { path: from }))];
  };
  const place = t(SYSTEM_PLACE[system]);
  const setting = t('deletedFilesSetting');
  return [
    ...group(
      of('system'),
      ({ from }) => {
        const folder = parentOf(from);
        const name = nameOf(from);
        return folder ? t('systemOne', { name, place, folder }) : t('systemOneRoot', { name, place });
      },
      t('systemMany', { count: of('system').length, place }),
    ),
    ...group(
      of('forever'),
      ({ from }) => t('foreverOne', { name: nameOf(from), setting }),
      t('foreverMany', { count: of('forever').length, setting }),
    ),
    ...group(
      of('missing'),
      ({ from }) => t('missingOne', { name: nameOf(from), folder: TRASH }),
      t('missingMany', { count: of('missing').length, folder: TRASH }),
    ),
    ...group(
      of('unknown'),
      ({ from }) => t('unknownOne', { name: nameOf(from), setting }),
      t('unknownMany', { count: of('unknown').length, setting }),
    ),
  ];
}

/**
 * Notice lines for undoing or redoing a deletion, below the first line: skips with reasons, Obsidian
 * refusals, where files not from the Obsidian trash are, and how many restored files Obsidian does not see
 * yet. Names as text only.
 */
export function trashLines(kind: 'undo' | 'redo', outcome: TrashOutcome, system: SystemTrash): string[] {
  const why = kind === 'undo' ? UNDO_WHY : REDO_WHY;
  const { unseen } = outcome;
  return [
    ...outcome.skipped.map(({ op, why: reason }) =>
      t('pathReason', { path: op.from, reason: t(why[reason]) }),
    ),
    ...outcome.failed.map(({ from, error }) => t('pathReason', { path: from, reason: error })),
    ...elsewhereLines(outcome.elsewhere, system),
    ...(unseen ? [t('unseen', { count: unseen })] : []),
  ];
}

/** How many files of the step were not restored or not deleted again. */
export function trashMissed(outcome: TrashOutcome): number {
  return outcome.skipped.length + outcome.failed.length + outcome.elsewhere.length;
}

/**
 * What is known about a key press: key code and `vkey`, modifiers. `mod` is Ctrl on Windows, Cmd on macOS
 * (`Keymap.isModifier(evt, 'Mod')`).
 */
export interface UndoKeyEvent {
  readonly code: string;
  readonly vkey?: string | null;
  readonly mod: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * Undo or redo key, as in the Obsidian canvas: Mod+Z undoes, Mod+Shift+Z and Mod+Y redo; anything else gives
 * `null`. The letter comes from the key code (Obsidian's `vkey`, from `keyCode`), as in Obsidian hotkeys, not
 * from the character (`key`): in a Cyrillic layout the Z key is still `Z`, while QWERTZ and AZERTY have their
 * own letters. If `vkey` is not a Latin letter (IME input) or missing, the physical key (`code`) is used.
 * With Alt, or with Ctrl and Cmd together, it is not ours.
 */
export function undoKey(evt: UndoKeyEvent): 'undo' | 'redo' | null {
  if (!evt.mod || evt.altKey || (evt.ctrlKey && evt.metaKey)) return null;
  const letter =
    evt.vkey && /^[A-Z]$/.test(evt.vkey) ? evt.vkey : /^Key[A-Z]$/.test(evt.code) ? evt.code.slice(3) : '';
  if (letter === 'Z') return evt.shiftKey ? 'redo' : 'undo';
  if (letter === 'Y') return evt.shiftKey ? null : 'redo';
  return null;
}
