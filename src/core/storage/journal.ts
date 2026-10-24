// A device journal line: JSON on one line (https://jsonlines.org/). The parser neither repairs nor
// drops a line with an unknown schema or a broken line: the index skips and counts them, and nobody
// rewrites a journal file.
import { isColorValue } from '../color/value.ts';
import { isIconId } from '../icon/icon-id.ts';
import { isLinkUrl } from './link.ts';
import { readPassportLine } from './passport.ts';
import {
  SCHEMA_VERSION,
  isDeviceId,
  isFolderPath,
  normalizeTag,
  tagKey,
  type KnownLine,
  type MetaAction,
  type Rating,
} from './types.ts';

/**
 * A known line is to be applied; unknown means a schema number above `SCHEMA_VERSION` or an unknown action;
 * broken means not JSON, a required field missing or of the wrong shape, or a cut-off last line.
 */
export type ParsedLine = { kind: 'line'; line: KnownLine } | { kind: 'unknown' } | { kind: 'broken' };

/**
 * Time exactly in `toISOString()` form: such strings compare as text, and the order is the same on any
 * device. The round trip rejects non-existent dates: some engines answer NaN for them, others roll the date
 * into the next month.
 */
function isTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const ms = Date.parse(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString() === value;
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isRating = (value: unknown): value is Rating =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5;
const known = (line: KnownLine | false): ParsedLine => (line ? { kind: 'line', line } : { kind: 'broken' });

/**
 * The `meta.set` setting. An unknown kind or field is "unknown": a newer version shapes its line its own
 * way, and its fields are not checked. A known field is checked strictly: a color goes into a style, so
 * only an `isColorValue` value or `null` ("no color") is accepted; a flag is boolean; a group or tag key
 * is a non-empty tag, a pinned color key is the color itself. A tag declaration is its spelling after
 * `normalizeTag` with the same key as the line, or `false` when deleted. Folder look: the key is a
 * folder path (`isFolderPath`), the color as for a tag, the icon `isIconId` or `null`, since its name
 * goes into `setIcon`.
 */
function meta(raw: Record<string, unknown>): MetaAction | false | null {
  const { kind, key, field, value } = raw;
  const color = value === null || isColorValue(value);
  const flag = typeof value === 'boolean';
  if (kind === 'group' || kind === 'tag') {
    const named = typeof key === 'string' && tagKey(key) !== null;
    if (field === 'color') return named && color && { op: 'meta.set', kind, key, field, value };
    if (field === 'exclusive' && kind === 'group')
      return named && flag && { op: 'meta.set', kind, key, field, value };
    if (field === 'declared' && kind === 'tag') {
      if (!named) return false;
      const spelled =
        value === false ||
        (typeof value === 'string' && normalizeTag(value) === value && tagKey(value) === tagKey(key));
      return spelled && { op: 'meta.set', kind, key, field, value };
    }
    return typeof field === 'string' ? null : false;
  }
  if (kind === 'palette') {
    if (field === 'pinned') return isColorValue(key) && flag && { op: 'meta.set', kind, key, field, value };
    return typeof field === 'string' ? null : false;
  }
  if (kind === 'folder') {
    const folder = isFolderPath(key);
    if (field === 'color') return folder && color && { op: 'meta.set', kind, key, field, value };
    if (field === 'icon')
      return folder && (value === null || isIconId(value)) && { op: 'meta.set', kind, key, field, value };
    return typeof field === 'string' ? null : false;
  }
  return typeof kind === 'string' ? null : false;
}

/** Parses one journal line. Extra fields of a known line do not prevent applying it and are not kept. */
export function parseLine(text: string): ParsedLine {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: 'broken' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'broken' };
  const { v, at, dev, op } = raw as Record<string, unknown>;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return { kind: 'broken' };
  // A newer schema may shape the line differently, so its fields are not checked.
  if (v > SCHEMA_VERSION) return { kind: 'unknown' };
  if (!isTime(at) || !isDeviceId(dev) || typeof op !== 'string') return { kind: 'broken' };
  const {
    path,
    tag,
    rating,
    id,
    text: body,
    to,
    size,
    mtime,
    url,
    done,
    gen,
  } = raw as Record<string, unknown>;
  switch (op) {
    case 'tag.add':
    case 'tag.remove':
      return known(
        isText(path) && typeof tag === 'string' && tagKey(tag) !== null && { v, at, dev, op, path, tag },
      );
    case 'rating.set':
      return known(isText(path) && isRating(rating) && { v, at, dev, op, path, rating });
    case 'comment.add':
      return known(
        isText(path) && isText(id) && typeof body === 'string' && { v, at, dev, op, path, id, text: body },
      );
    case 'comment.remove':
      return known(isText(path) && isText(id) && { v, at, dev, op, path, id });
    case 'comment.done':
      return known(
        isText(path) && isText(id) && typeof done === 'boolean' && { v, at, dev, op, path, id, done },
      );
    case 'file.move':
      return known(isText(path) && isText(to) && { v, at, dev, op, path, to });
    case 'file.seen':
      return known(
        isText(path) && isNumber(size) && isNumber(mtime) && { v, at, dev, op, path, size, mtime },
      );
    // The link is opened in the system browser, so only http and https are accepted.
    case 'link.set':
      return known(isText(path) && (url === null || isLinkUrl(url)) && { v, at, dev, op, path, url });
    // A passport is checked field by field (passport.ts); a broken one is not applied and the previous one
    // stays.
    case 'gen.set': {
      if (!isText(path)) return { kind: 'broken' };
      if (gen === null) return { kind: 'line', line: { v, at, dev, op, path, gen } };
      const passport = readPassportLine(gen);
      return known(passport !== null && { v, at, dev, op, path, gen: passport });
    }
    case 'meta.set': {
      const action = meta(raw as Record<string, unknown>);
      return action === null ? { kind: 'unknown' } : known(action && { v, at, dev, ...action });
    }
    default:
      return { kind: 'unknown' };
  }
}

/** Line to append to the journal: JSON on one line plus a newline. */
export function formatLine(line: KnownLine): string {
  return `${JSON.stringify(line)}\n`;
}
