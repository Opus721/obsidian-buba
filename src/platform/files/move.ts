// Batch move: only `fileManager.renameFile`, which updates links (`vault.rename` does not). Before a batch
// its plan goes to the device's action journal, and each move gets a line before and after; after a crash the
// unfinished part is found in the journal and checked against disk, to finish or leave it. Only types come
// from `obsidian`: the test substitutes a fake `app`.
import type { App } from 'obsidian';
import {
  planLines,
  reconcile,
  stageLine,
  unfinishedFold,
  type MoveOp,
  type UnfinishedBatch,
} from '../../core/actions/journal.ts';
import { planMoves, type SkipReason, type Skipped } from '../../core/actions/move-plan.ts';
import { t } from '../../core/i18n/dict/platform.ts';
import { deviceId } from '../device.ts';
import { actionJournal } from './action-journal.ts';
import { BATCH_MIN, inBatch } from './batch.ts';

export type Failed = MoveOp & { error: string };
/**
 * Batch result: moved; skipped by the plan, with a reason; failed, with the error text; `left` only when the
 * batch was stopped: what stayed in place.
 */
export type MoveResult = { moved: MoveOp[]; skipped: Skipped[]; failed: Failed[]; left?: MoveOp[] };
/** Watch over a batch: progress after each move, and a stop asked before the next one. */
export interface MoveWatch {
  /** Moves handled so far (moved or failed) out of `total`. */
  progress?(handled: number, total: number): void;
  /** `true` stops the batch: the moves not yet made get `left` lines and stay in place. */
  stopped?(): boolean;
}
/**
 * An unfinished move and its check against disk: `done` means the file is already at the new place, `pending`
 * that it is still at the old one, `conflict` that both paths exist or neither does.
 */
export type UnfinishedMove = MoveOp & { seq: number; started: boolean; state: ReturnType<typeof reconcile> };
export type UnfinishedMoves = { batch: string; ops: UnfinishedMove[] };

const now = () => new Date().toISOString();
const inVault = (app: App) => (path: string) => app.vault.getAbstractFileByPath(path) !== null;

function context(app: App) {
  const device = deviceId(app);
  return { app, device, journal: actionJournal(app, device) };
}
type Context = ReturnType<typeof context>;

/** Batch id: plan time plus 8 random hex digits, so two batches in the same millisecond never merge. */
function batchId(at: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `${at}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Moves of a large batch that share one "started" append and one append of their outcomes. */
export const JOURNAL_CHUNK = 50;

/** `renameFile` of one move; the error text, or `undefined` if it moved. */
async function rename(app: App, op: MoveOp): Promise<string | undefined> {
  try {
    const file = app.vault.getAbstractFileByPath(op.from);
    if (!file) throw new Error(t('fileMissing'));
    await app.fileManager.renameFile(file, op.to);
  } catch (caught) {
    return caught instanceof Error && caught.message ? caught.message : String(caught);
  }
  return undefined;
}

/**
 * Moves `chunk` (each with its 1-based `seq`): "started" lines of all → `renameFile` one by one → "done" or
 * "failed" lines of all. A failed move does not stop the batch; a failed journal write throws: without a
 * "started" line the file is not touched, and a move without "done" is found by the startup check, which
 * looks at the disk. A chunk of one is "started" → `renameFile` → "done"; a large batch takes
 * `JOURNAL_CHUNK` moves at a time, since one journal append costs about as much as one `renameFile`.
 */
async function moveChunk(
  { app, device, journal }: Context,
  batch: string,
  chunk: readonly { seq: number; op: MoveOp }[],
  result: MoveResult,
  watch: MoveWatch,
  total: number,
) {
  await journal.append(chunk.map(({ seq }) => stageLine(batch, seq, 'start', now(), device)));
  const outcomes = [];
  for (const { seq, op } of chunk) {
    if (watch.stopped?.()) {
      outcomes.push(stageLine(batch, seq, 'left', now(), device));
      (result.left ??= []).push(op);
      continue;
    }
    const error = await rename(app, op);
    if (error === undefined) {
      outcomes.push(stageLine(batch, seq, 'done', now(), device));
      result.moved.push(op);
    } else {
      outcomes.push(stageLine(batch, seq, 'fail', now(), device, error));
      result.failed.push({ ...op, error });
    }
    watch.progress?.(result.moved.length + result.failed.length, total);
  }
  await journal.append(outcomes);
}

/**
 * Moves `paths` into `targetFolder` (`'/'` for the vault root): a plan without overwrites → plan lines to the
 * device journal → one move at a time. Items skipped by the plan are not journaled; with nothing to move the
 * journal is untouched.
 */
export async function moveFiles(
  app: App,
  paths: readonly string[],
  targetFolder: string,
  watch: MoveWatch = {},
): Promise<MoveResult> {
  const { ops, skipped } = planMoves(paths, targetFolder, inVault(app));
  const { moved, failed, left } = await moveOps(app, ops, watch);
  return { moved, skipped, failed, ...(left && { left }) };
}

/**
 * Moves `ops` as a batch, each into its own folder (used by undo and redo): plan lines to the device journal
 * → "started" → `renameFile` → "done" or "failed", per move or per `JOURNAL_CHUNK` moves. Stopped by `watch`,
 * the rest gets `left` lines in one append. The caller does the disk check; with nothing to move the journal
 * is untouched.
 */
export async function moveOps(app: App, ops: readonly MoveOp[], watch: MoveWatch = {}): Promise<MoveResult> {
  const result: MoveResult = { moved: [], skipped: [], failed: [] };
  if (ops.length === 0) return result;
  const ctx = context(app);
  const at = now();
  const batch = batchId(at);
  await ctx.journal.append(planLines(batch, ops, at, ctx.device));
  const size = ops.length >= BATCH_MIN ? JOURNAL_CHUNK : 1;
  const numbered = ops.map((op, index) => ({ seq: index + 1, op }));
  await inBatch(ops.length, async () => {
    for (let at = 0; at < numbered.length; at += size) {
      if (watch.stopped?.()) {
        const rest = numbered.slice(at);
        await ctx.journal.append(rest.map(({ seq }) => stageLine(batch, seq, 'left', now(), ctx.device)));
        (result.left ??= []).push(...rest.map(({ op }) => op));
        break;
      }
      await moveChunk(ctx, batch, numbered.slice(at, at + size), result, watch, ops.length);
    }
  });
  return result;
}

/** Unfinished batches in the own device journal, folded line by line without holding all lines in memory. */
async function openBatches({ journal }: Context): Promise<UnfinishedBatch[]> {
  const fold = unfinishedFold();
  await journal.readOwn((line) => fold.add(line));
  return fold.result();
}

/** Unfinished batches of this device for this and the previous month, each move checked against disk. */
export async function unfinishedMoves(app: App): Promise<UnfinishedMoves[]> {
  const onDisk = inVault(app);
  return (await openBatches(context(app))).map(({ batch, ops }) => ({
    batch,
    ops: ops.map((op) => ({ ...op, state: reconcile(op, onDisk) })),
  }));
}

async function openOps(ctx: Context, batch: string) {
  return (await openBatches(ctx)).find((found) => found.batch === batch)?.ops ?? [];
}

/**
 * "Finish" batch `batch`: a move not yet done on disk is redone with lines before and after; one already done
 * gets a "done" line; if both paths exist or neither does, a "failed" line with the reason and nothing on
 * disk is touched.
 */
export async function finishMoves(app: App, batch: string): Promise<MoveResult> {
  const ctx = context(app);
  const onDisk = inVault(app);
  const result: MoveResult = { moved: [], skipped: [], failed: [] };
  for (const { seq, from, to } of await openOps(ctx, batch)) {
    const op = { from, to };
    const state = reconcile(op, onDisk);
    if (state === 'pending') {
      await moveChunk(ctx, batch, [{ seq, op }], result, {}, 1);
    } else if (state === 'done') {
      await ctx.journal.append([stageLine(batch, seq, 'done', now(), ctx.device)]);
      result.moved.push(op);
    } else {
      const error: SkipReason = onDisk(from) ? 'taken' : 'missing';
      await ctx.journal.append([stageLine(batch, seq, 'fail', now(), ctx.device, error)]);
      result.failed.push({ ...op, error });
    }
  }
  return result;
}

/** "Leave" batch `batch`: the unfinished part is closed with `left` lines; nothing changes on disk. */
export async function leaveMoves(app: App, batch: string): Promise<void> {
  const ctx = context(app);
  const at = now();
  await ctx.journal.append(
    (await openOps(ctx, batch)).map(({ seq }) => stageLine(batch, seq, 'left', at, ctx.device)),
  );
}
