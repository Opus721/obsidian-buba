// Pure part of the file panel's "Comments" section: row order, labels and input checks, with no `obsidian`
// import so `node --test` tests it as is. Comment text is external input: it is passed on as is, unparsed,
// and the section shows it only as text.
import { t } from '../../core/i18n/dict/inspector.ts';
import type { FileComment } from '../../core/storage/types.ts';
import {
  DEFAULT_DATE_LOOK,
  formatDateTime,
  formatRelative,
  type DateLook,
} from '../../core/inspector/date.ts';

export interface CommentRow {
  id: string;
  text: string;
  /**
   * When it was added, short and without "ago": "now", "5 min", "3 h", "2 d", "Oct 6". The device is not
   * shown, though the data keeps it.
   */
  meta: string;
  /** Full date and time per the "Date format" and "Time format" settings; the row tooltip. */
  full: string;
  /** Marked as done. */
  done: boolean;
}

/** Compares by code units: no locale, so the order is the same on every device. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Comment rows: open ones on top, done ones below (like "Automatically sort checked items" in Apple Notes and
 * "Move checked items to bottom" in Google Keep); within each part by ascending time, ties by `id`. Dates
 * follow the "Date format" and "Time format" settings (`look`), month names the Obsidian language; the time
 * zone is the device's unless given; short times are relative to `now`.
 */
export function commentRows(
  comments: readonly FileComment[],
  language: string | undefined,
  timeZone?: string,
  look: Readonly<DateLook> = DEFAULT_DATE_LOOK,
  now: number = Date.now(),
): CommentRow[] {
  return [...comments]
    .sort(
      (a, b) =>
        Number(a.done ?? false) - Number(b.done ?? false) ||
        Date.parse(a.at) - Date.parse(b.at) ||
        compare(a.id, b.id),
    )
    .map(({ id, text, at, done }) => ({
      id,
      text,
      meta: formatRelative(Date.parse(at), now, language, look, timeZone),
      full: formatDateTime(Date.parse(at), language, look, timeZone),
      done: done ?? false,
    }));
}

/** Rows in two groups: open rows are always visible, done ones sit under a "Done (N)" row. */
export interface CommentGroups {
  open: CommentRow[];
  done: CommentRow[];
}

/** Splits `commentRows` rows into open and done, keeping the order within each. */
export function commentGroups(rows: readonly CommentRow[]): CommentGroups {
  return { open: rows.filter((row) => !row.done), done: rows.filter((row) => row.done) };
}

/** Label of the toggle row of the done group. */
export function doneTitle(count: number): string {
  return t('doneGroup', { count });
}

/**
 * Comment length limit in characters (UTF-16 code units, like the field's `maxLength`): a long note fits, the
 * journal does not bloat.
 */
export const COMMENT_MAX = 1000;

/** The counter under the field appears when fewer than this many characters are left. */
const LEFT_FROM = 200;

/** Quiet counter under the field: "N left" when fewer than `LEFT_FROM` remain; otherwise nothing. */
export function leftNote(length: number): string | null {
  const left = Math.max(0, COMMENT_MAX - length);
  return left < LEFT_FROM ? t('commentLeft', { count: left }) : null;
}

/** Whether pasting `text` over `selected` selected characters in a field of `length` exceeds the limit. */
export function pasteOverflows(length: number, selected: number, text: string): boolean {
  return length - selected + text.length > COMMENT_MAX;
}

/** Adding is allowed only if the text is not empty after trimming. */
export function canAdd(text: string): boolean {
  return text.trim() !== '';
}

/** The comment input as `sendComment` sees it: read the text and set the text. */
export interface CommentField {
  get(): string;
  set(text: string): void;
}

/** Fields with a comment write in flight: until it ends, the next send leaves the text alone. */
const writing = new WeakSet<CommentField>();

/**
 * Sends the comment from the field. The sent text leaves the field at once, before the write answers, as in a
 * message form: what is typed during the write belongs to the next comment and stays. If the write fails, the
 * sent text comes back: alone in an empty field, otherwise followed by a newline and the typed text; the
 * error is rethrown for the section to show. Empty text and a send during a write do nothing: the field stays
 * as is.
 */
export async function sendComment(
  field: CommentField,
  write: (text: string) => Promise<unknown>,
): Promise<void> {
  const typed = field.get();
  if (writing.has(field) || !canAdd(typed)) return;
  const text = typed.trim();
  field.set('');
  writing.add(field);
  try {
    await write(text);
  } catch (error) {
    const next = field.get();
    field.set(canAdd(next) ? `${text}\n${next}` : text);
    throw error;
  } finally {
    writing.delete(field);
  }
}
