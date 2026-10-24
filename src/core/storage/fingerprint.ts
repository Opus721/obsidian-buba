// Obsidian sees a move made in the system file manager as "created + deleted" with no rename event; with
// Obsidian open, "created" comes first and "deleted" about 100 ms later. Such a file is recognized by its
// fingerprint (size, modification time, name): right away by pairing the two events, at startup by matching
// missing paths against files without records, and a file that arrives later than the window by the missing
// paths storage remembers (store.ts). No `obsidian` import and no clock: time is passed in, and the caller
// clears the window with `expire`.
import type { Fingerprint } from './types.ts';

/** Path from the vault root and the file fingerprint. */
export interface FingerprintedFile {
  path: string;
  fp: Fingerprint;
}

/** A move: records follow the file from `from` to `to`. */
export interface Move {
  from: string;
  to: string;
}

/**
 * Pairing key `size:mtime:name`; content is not read. Copies of one file match on all three fields, and a
 * file renamed in the system file manager is not recognized: the accepted cost of this approach.
 */
export function fingerprintKey(fp: Fingerprint): string {
  return `${fp.size}:${fp.mtime}:${fp.name}`;
}

export interface MoveMatcher {
  /**
   * A file appeared: a move if it has exactly one partner among the files that disappeared in the stream,
   * otherwise `null`. If the stream holds no other file with this key, `late` may name a partner from beyond
   * the window: the path of the disappeared file or `null`; with such a partner the appeared file does not
   * wait. Within the window pairing decides, and `late` is not called.
   */
  appeared(path: string, fp: Fingerprint, now: number, late?: () => string | null): Move | null;
  /**
   * A file disappeared: a move if it has exactly one partner among the files that appeared in the
   * stream, otherwise `null`.
   */
  disappeared(path: string, fp: Fingerprint, now: number): Move | null;
  /**
   * Unpaired disappeared files from a stream that went quiet: "missing", not "deleted", so their records are
   * not erased; each is returned once. Unpaired appeared files are forgotten silently. It walks all waiting
   * entries, so call it on a timer, not on every event.
   */
  expire(now: number): FingerprintedFile[];
  /** Whether files with key `fp` wait on both sides: pairing found no partner because it is not unique. */
  contested(fp: Fingerprint): boolean;
}

interface Pending extends FingerprintedFile {
  key: string;
}

/**
 * Events of one side waiting for a partner, by path and by key: a partner is found without scanning
 * all waiting entries.
 */
class Waiting {
  readonly byPath = new Map<string, Pending>();
  private readonly byKey = new Map<string, Set<Pending>>();

  put(entry: Pending): void {
    this.byPath.set(entry.path, entry);
    const group = this.byKey.get(entry.key);
    if (group) group.add(entry);
    else this.byKey.set(entry.key, new Set([entry]));
  }

  take(path: string): Pending | undefined {
    const entry = this.byPath.get(path);
    if (!entry) return undefined;
    this.byPath.delete(path);
    const group = this.byKey.get(entry.key);
    group?.delete(entry);
    if (!group?.size) this.byKey.delete(entry.key);
    return entry;
  }

  withKey(key: string): Pending[] {
    return [...(this.byKey.get(key) ?? [])];
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }
}

/** Quiet time after which a disappeared file without an appeared partner is missing, not moved. */
export const MOVE_WINDOW_MS = 2000;

/**
 * Pairs "appeared + disappeared" in any order while the event stream keeps going: the `windowMs` window is
 * measured from the stream's last event, not from the event's own time. Obsidian delivers move events one by
 * one, and with a thousand files "disappeared" lags its "appeared" by 0.7-3.7 s while the pause between
 * neighbouring events is up to 0.4 s (measured); Watchman waits for quiet the same way (`settle`,
 * https://facebook.github.io/watchman/docs/config#settle). A pause longer than the window drops all waiting
 * entries: appeared ones are forgotten, disappeared ones become missing until the next `expire`. A pair is
 * made only when it is unique on both sides: two or more files with one key in the stream are not paired at
 * all, since "missing" is better than another file's tags. The same path is not a move: a file that came back
 * to its own place is not missing.
 */
export function createMoveMatcher({ windowMs = MOVE_WINDOW_MS }: { windowMs?: number } = {}): MoveMatcher {
  const appeared = new Waiting();
  const disappeared = new Waiting();
  /** Unpaired disappeared files from a stream that went quiet, by path, until the next `expire`. */
  const lost = new Map<string, Fingerprint>();
  /** Time of the stream's last event. */
  let last = -Infinity;

  /**
   * A pause after the last event longer than the window means the stream went quiet: waiting
   * entries are dropped.
   */
  function settle(now: number): void {
    if (now - last <= windowMs) return;
    for (const entry of [...appeared.byPath.values()]) appeared.take(entry.path);
    for (const entry of [...disappeared.byPath.values()]) {
      disappeared.take(entry.path);
      lost.set(entry.path, entry.fp);
    }
  }

  /** A stream event: first drop the waiting entries of a quiet stream, then move its end. */
  function event(now: number): void {
    settle(now);
    last = Math.max(last, now);
  }

  /** Path of the unique partner on the other side; without one, the event itself waits for a partner. */
  function pair(own: Waiting, other: Waiting, path: string, fp: Fingerprint): string | null {
    const key = fingerprintKey(fp);
    const partners = other.withKey(key);
    const [partner] = partners;
    if (partner && partners.length === 1 && own.withKey(key).length === 0) {
      other.take(partner.path);
      return partner.path;
    }
    own.put({ path, fp, key });
    return null;
  }

  return {
    appeared(path, fp, now, late) {
      event(now);
      if (disappeared.take(path) || lost.delete(path)) return null;
      appeared.take(path);
      const key = fingerprintKey(fp);
      const away = late && !appeared.has(key) && !disappeared.has(key) ? late() : null;
      if (away !== null) return { from: away, to: path };
      const from = pair(appeared, disappeared, path, fp);
      return from === null ? null : { from, to: path };
    },
    disappeared(path, fp, now) {
      event(now);
      appeared.take(path);
      disappeared.take(path);
      lost.delete(path);
      const to = pair(disappeared, appeared, path, fp);
      return to === null ? null : { from: path, to };
    },
    expire(now) {
      settle(now);
      const gone = [...lost].map(([path, fp]) => ({ path, fp }));
      lost.clear();
      return gone;
    },
    contested(fp) {
      const key = fingerprintKey(fp);
      return appeared.has(key) && disappeared.has(key);
    },
  };
}

/**
 * Startup check: missing paths with a known fingerprint against files without records. Only one-to-one pairs
 * match: a key shared by two missing paths or two candidates does not match at all.
 */
export function matchMissing(
  missing: readonly FingerprintedFile[],
  candidates: readonly FingerprintedFile[],
): Move[] {
  const found = soleByKey(candidates);
  const moves: Move[] = [];
  for (const [key, from] of soleByKey(missing)) {
    const to = found.get(key);
    if (from !== null && typeof to === 'string') moves.push({ from, to });
  }
  return moves;
}

/** Key to the only path with that key; `null` if there are two or more. */
function soleByKey(files: readonly FingerprintedFile[]): Map<string, string | null> {
  const byKey = new Map<string, string | null>();
  for (const { path, fp } of files) {
    const key = fingerprintKey(fp);
    byKey.set(key, byKey.has(key) ? null : path);
  }
  return byKey;
}
