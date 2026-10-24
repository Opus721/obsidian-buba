// Buba action journal: the plan before a batch, a line before and after each action, and the previous canvas
// text before it is written. No `obsidian` import. File: `<data folder>/actions/<device>-<YYYY-MM>.jsonl`,
// JSON Lines, append only; the data folder name is `JOURNAL_DIR`.
import { JOURNAL_DIR } from '../storage/types.ts';

/** Line schema version: a line with another version is neither parsed nor lost. */
export const ACTIONS_SCHEMA = 1;
/** Own folder: tag journals are read as `<data folder>/*.jsonl`, and action lines must not land there. */
export const ACTIONS_DIR = `${JOURNAL_DIR}/actions`;

/** `left` is the user's "leave as is" after a failure; it closes an action like `done` and `fail`. */
export type Stage = 'plan' | 'start' | 'done' | 'fail' | 'left';
export type MoveOp = { from: string; to: string };

/** `at` is ISO 8601 UTC, `dev` the device id, `seq` the action number within the batch, from 1. */
type LineBase = { v: typeof ACTIONS_SCHEMA; at: string; dev: string; batch: string; seq: number };
export type PlanLine = LineBase & MoveOp & { op: 'move'; stage: 'plan' };
export type StageLine = LineBase & { op: 'move'; stage: Exclude<Stage, 'plan'>; error?: string };
export type CanvasLine = LineBase & { op: 'canvas.write'; stage: Stage; path: string; before: string };
export type ActionLine = PlanLine | StageLine | CanvasLine;

/** Lines the parser sets aside, as the original file lines, unchanged. */
export type Rejected = { unknown: string[]; broken: string[] };
export type ParsedActions = Rejected & { lines: ActionLine[] };
type OpenOp = MoveOp & { seq: number; started: boolean };
export type UnfinishedBatch = { batch: string; ops: OpenOp[] };

const OPS: readonly string[] = ['move', 'canvas.write'];
const STAGES: readonly string[] = ['plan', 'start', 'done', 'fail', 'left'];

/** Batch plan, written before the first move: one line per move. */
export function planLines(batch: string, ops: readonly MoveOp[], at: string, dev: string): PlanLine[] {
  return ops.map(({ from, to }, index) => ({
    v: ACTIONS_SCHEMA,
    at,
    dev,
    batch,
    seq: index + 1,
    op: 'move',
    stage: 'plan',
    from,
    to,
  }));
}

/** Line before an action (`start`) or after it: `done`, `fail` with the error text, `left`. */
export function stageLine(
  batch: string,
  seq: number,
  stage: StageLine['stage'],
  at: string,
  dev: string,
  error?: string,
): StageLine {
  const line: StageLine = { v: ACTIONS_SCHEMA, at, dev, batch, seq, op: 'move', stage };
  if (error !== undefined) line.error = error;
  return line;
}

/** Previous canvas text, before the write. A canvas write is a batch of one action named by its time. */
export function canvasLine(entry: { path: string; before: string }, at: string, dev: string): CanvasLine {
  const { path, before } = entry;
  return { v: ACTIONS_SCHEMA, at, dev, batch: at, seq: 1, op: 'canvas.write', stage: 'start', path, before };
}

/**
 * The device's file for the UTC month of `date`. The device id goes into the path, so one with `/`, `\`, `..`
 * or an empty one would put the write outside the journal folder (writes stay inside the vault): it throws.
 */
export function actionsFile(device: string, date: Date | number): string {
  if (device === '' || /[/\\]|\.\./.test(device)) {
    throw new RangeError(`Device id is not valid in a file name: ${JSON.stringify(device)}`);
  }
  return `${ACTIONS_DIR}/${device}-${new Date(date).toISOString().slice(0, 7)}.jsonl`;
}

/**
 * Parses a journal file. Never throws: an unknown schema, action or stage goes to `unknown`, anything else
 * invalid to `broken` (not JSON, a missing field, a line cut short by a crash).
 */
export function parseActions(text: string): ParsedActions {
  const parsed: ParsedActions = { lines: [], unknown: [], broken: [] };
  for (const raw of text.split('\n')) takeLine(raw, (line) => parsed.lines.push(line), parsed);
  return parsed;
}

/** One raw line: valid goes to `each`, unknown and broken to their `rejected` list, blank is skipped. */
export function takeLine(raw: string, each: (line: ActionLine) => void, rejected: Rejected): void {
  if (raw.trim() === '') return;
  const line = classify(raw);
  if (line === 'unknown' || line === 'broken') rejected[line].push(raw);
  else each(line);
}

/**
 * Splits a journal into lines from byte chunks as a stream delivers them. `TextDecoder` with `stream: true`
 * holds a partial UTF-8 character until the next chunk, and a partial line is held too; a line is joined from
 * its pieces once, when its newline arrives. `end()` marks the end of file: a last line without a newline is
 * still a line. One splitter per file.
 */
export function lineSplitter(): { push(bytes: Uint8Array): string[]; end(): string[] } {
  const decoder = new TextDecoder();
  let pieces: string[] = [];
  const cut = (text: string) => {
    const lines: string[] = [];
    let from = 0;
    for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', from)) {
      pieces.push(text.slice(from, at));
      lines.push(pieces.join(''));
      pieces = [];
      from = at + 1;
    }
    if (from < text.length) pieces.push(text.slice(from));
    return lines;
  };
  return {
    push: (bytes) => cut(decoder.decode(bytes, { stream: true })),
    end: () => {
      const lines = cut(decoder.decode());
      if (pieces.length > 0) lines.push(pieces.join(''));
      pieces = [];
      return lines;
    },
  };
}

function classify(raw: string): ActionLine | 'unknown' | 'broken' {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return 'broken';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'broken';
  const line = value as Record<string, unknown>;
  if (line.v !== ACTIONS_SCHEMA) {
    return typeof line.v === 'number' && Number.isInteger(line.v) && line.v > ACTIONS_SCHEMA
      ? 'unknown'
      : 'broken';
  }
  if (typeof line.op !== 'string' || typeof line.stage !== 'string') return 'broken';
  if (!OPS.includes(line.op) || !STAGES.includes(line.stage)) return 'unknown';
  const text = (key: string) => typeof line[key] === 'string';
  const base =
    text('at') && text('dev') && text('batch') && Number.isSafeInteger(line.seq) && Number(line.seq) > 0;
  const fields =
    line.op === 'canvas.write'
      ? text('path') && text('before')
      : line.stage === 'plan'
        ? text('from') && text('to')
        : line.error === undefined || text('error');
  return base && fields ? (line as ActionLine) : 'broken';
}

/** Batches where a planned action has no `done`, `fail` or `left`; `started` means a start line was seen. */
export function unfinished(lines: Iterable<ActionLine>): UnfinishedBatch[] {
  const fold = unfinishedFold();
  for (const line of lines) fold.add(line);
  return fold.result();
}

/**
 * Folds unfinished work one line at a time, like the analysis pass of ARIES recovery: forward through the
 * journal, keeping only what is still open. A plan line opens an action, a start line marks it, done, fail
 * and left close and drop it; canvas lines are not kept. A start or close that comes before its plan (the
 * plan is older than the read window, or the clock went back) is remembered by key, and the later plan takes
 * it into account as if it had come first.
 */
export function unfinishedFold(): { add(line: ActionLine): void; result(): UnfinishedBatch[] } {
  const key = (batch: string, seq: number) => JSON.stringify([batch, seq]);
  const open = new Map<string, Map<number, OpenOp>>();
  const startedEarly = new Set<string>();
  const closedEarly = new Set<string>();
  return {
    add(line) {
      if (line.op !== 'move') return;
      const { batch, seq } = line;
      const id = key(batch, seq);
      const ops = open.get(batch);
      const op = ops?.get(seq);
      if (line.stage === 'plan') {
        if (closedEarly.has(id)) return;
        const plan = ops ?? new Map<number, OpenOp>();
        open.set(batch, plan);
        const started = (op?.started ?? false) || startedEarly.delete(id);
        plan.set(seq, { seq, from: line.from, to: line.to, started });
      } else if (line.stage === 'start') {
        if (op) op.started = true;
        else startedEarly.add(id);
      } else if (ops && op) {
        ops.delete(seq);
        if (ops.size === 0) open.delete(batch);
      } else {
        startedEarly.delete(id);
        closedEarly.add(id);
      }
    },
    result: () =>
      [...open].map(([batch, ops]) => ({
        batch,
        ops: [...ops.values()]
          .sort((a, b) => a.seq - b.seq)
          .map(({ seq, from, to, started }) => ({ seq, from, to, started })),
      })),
  };
}

/** Checks an unfinished move against the disk, for "finish or leave as is". */
export function reconcile(op: MoveOp, exists: (path: string) => boolean): 'done' | 'pending' | 'conflict' {
  const source = exists(op.from);
  const target = exists(op.to);
  if (!source && target) return 'done';
  if (source && !target) return 'pending';
  return 'conflict';
}
