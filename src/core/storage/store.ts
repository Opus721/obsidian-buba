// Storage of tags, ratings and comments. An action puts its lines into the index and to subscribers at once,
// then appends them to this device's journal, batched with lines that arrived while the previous append was
// running; storage never writes other devices' journals.
//
// Memory before disk, like Firestore "latency compensation": a local write is visible to listeners at once
// (https://firebase.google.com/docs/firestore/query-data/listen#events-for-local-changes), so a move of a
// file with records reaches the grid in the same task as the file index event. Journal-before-memory order
// is not needed here: the move is already on disk as the file itself, and a lost move line is found at
// startup by `reconcile`.
//
// Line time is a hybrid logical clock (Kulkarni et al., 2014,
// https://cse.buffalo.edu/tech-reports/2014-04.pdf): never earlier than the device clock and later than any
// line read, so one device's fast clock does not override another device's edits. The logical part is a 1 ms
// step rather than a separate counter: the index orders lines by time, device and line position
// (record-index.ts), and a line has no counter field. The limit is one day ahead of the device clock: a line
// beyond it is not applied and does not pull the clock until its time comes, the way HLC rejects time beyond
// the allowed drift; the journal file stays intact.
//
// Exclusive tag groups: setting a tag of such a group removes its group neighbours from the file in the same
// write, and removing the visible one removes the hidden ones too, so a version without groups sees the
// change as well. A tag lives until deleted: setting a tag declares it if it is not declared, and removing a
// tag with no declaration line yet (set before the update) declares it too, in the same write; deletion is
// one write together with removal from all files.
//
// A foreign move chain P->Q->R is written as one `file.move` line per step, in one write, so a version
// without chains folds it too: the first step lands on an empty path, the last merges by the same-move rule.
// A missing path with records waits for its file even after the pairing window: a file without records with
// the same fingerprint arriving seconds later is the same move, written as one `file.move` line, the same one
// the startup check writes; no timers.
//
// A file's link is a path record like the rating: a path with only a link is moved and checked like a path
// with tags. So is a generation passport, and so is every path a passport names as a reference. Folder look is `meta.set` lines keyed by folder path: it follows a rename in the same write as
// `file.move`, exactly from path `from`, like Obsidian bookmarks; look subscribers are separate.
//
// No `obsidian` import and no timers: I/O, time and fingerprints come in as parameters.
import { isColorValue, type ColorValue } from '../color/value.ts';
import { isIconId } from '../icon/icon-id.ts';
import { groupKey } from '../tags/groups.ts';
import {
  createMoveMatcher,
  fingerprintKey,
  matchMissing,
  type FingerprintedFile,
  type Move,
} from './fingerprint.ts';
import { formatLine, parseLine } from './journal.ts';
import { isLinkUrl } from './link.ts';
import {
  LINE_MAX,
  PassportRefused,
  passportKey,
  readPassportInput,
  refPaths,
  type Passport,
} from './passport.ts';
import { RecordIndex } from './record-index.ts';
import {
  COVERS_DIR,
  SCHEMA_VERSION,
  isCoverFrame,
  isCoverName,
  isDeviceId,
  isFolderPath,
  journalPath,
  normalizeTag,
  tagKey,
  type FileComment,
  type Fingerprint,
  type JournalAction,
  type JournalIO,
  type KnownLine,
  type MetaAction,
  type StorageEngine,
} from './types.ts';

export interface StoreOptions {
  io: JournalIO;
  /** Own device id: 8 characters `[a-z0-9]`. */
  device: string;
  /** Device clock, ms since 1970. */
  now: () => number;
  /** File size and modification time by path; `null` if there is no file. */
  statOf: (path: string) => { size: number; mtime: number } | null | undefined;
}

export interface Store extends StorageEngine {
  /** Journal lines: applied; skipped unknown and broken; deferred ones are more than a day ahead. */
  stats(): { lines: number; unknown: number; broken: number; deferred: number };
  /**
   * Clears the move pairing window and returns paths that disappeared without a partner: "missing", their
   * records stay. Runs in the same queue as events and measures the window by the call time, so a pair whose
   * second event has already arrived and waits in the queue is not broken. It walks all waiting entries, so
   * the platform calls it on a timer, not on every event.
   */
  expire(): Promise<string[]>;
}

/** Line time limit: one day ahead of the device clock, ms. */
const HORIZON = 24 * 60 * 60 * 1000;

/**
 * Line start of this version: `formatLine` writes `v` and `at` first; the time is 24
 * chars of `toISOString()`.
 */
const HEAD = `{"v":${SCHEMA_VERSION},"at":"`;

/**
 * The time of a line of this version is read from its start without parsing, if the line has a single `at`
 * key: with repeated keys `JSON.parse` in the index takes the last one, and it compares names after
 * unescaping (RFC 7493 §2.3). Without a backslash the `at` key can only be written as `"at"`, and a space
 * before the colon does not change those characters: no second `"at"` after the start means no second key.
 * Otherwise the line is parsed in full, by the same parser as the index; so are false matches: an `"at"`
 * value, a backslash or a quote in a comment text.
 */
function quickAt(raw: string): string | null {
  return raw.startsWith(HEAD) && !raw.includes('\\') && raw.indexOf('"at"', HEAD.length) === -1
    ? raw.slice(HEAD.length, HEAD.length + 24)
    : null;
}

/**
 * Journals for the index: a known line with a time later than `cut` is deferred, so the index does not see
 * it yet, and the file text on disk stays intact. `latest` is the latest time of applied lines, ms; 0 if
 * there are none. A device's lines go in time order, so a file is read from the end, and a line of this
 * version no later than the latest found is skipped by its start without parsing, when `quickAt` read the
 * same time the index would.
 */
function sift(files: readonly { file: string; text: string }[], cut: string) {
  let latest = '';
  let deferred = 0;
  const sifted = files.map(({ file, text }) => {
    const rows = text.split('\n');
    let dropped = false;
    for (let i = rows.length - 1; i >= 0; i--) {
      const raw = rows[i] ?? '';
      const at = quickAt(raw);
      if (!raw || (at !== null && at <= latest)) continue;
      const parsed = parseLine(raw);
      if (parsed.kind !== 'line') continue;
      if (parsed.line.at > cut) {
        rows[i] = '';
        dropped = true;
        deferred++;
      } else if (parsed.line.at > latest) latest = parsed.line.at;
    }
    return dropped ? { file, text: rows.join('\n') } : { file, text };
  });
  return { files: sifted, latest: latest ? Date.parse(latest) : 0, deferred };
}

/**
 * Same file on this device: size and modification time match, i.e. the fingerprint without the name, since
 * the name at the new path comes from the journal move. No fingerprint means not the same.
 */
function sameFile(a: { size: number; mtime: number } | null | undefined, b: Fingerprint): boolean {
  return !!a && a.size === b.size && a.mtime === b.mtime;
}

/** Tags of a call: comparison key -> spelling after `normalizeTag`; an empty tag is refused up front. */
function tagList(tags: readonly string[]): Map<string, string> {
  const list = new Map<string, string>();
  for (const tag of tags) {
    const spelled = normalizeTag(tag);
    if (spelled === null) throw new RangeError(`Empty tag: ${JSON.stringify(tag)}`);
    const key = spelled.toLowerCase();
    if (!list.has(key)) list.set(key, spelled);
  }
  return list;
}

/** Group or tag key of a setting; an empty name is refused before writing. */
function metaKey(name: string): string {
  const key = tagKey(name);
  if (key === null) throw new RangeError(`Empty name: ${JSON.stringify(name)}`);
  return key;
}

/** Setting color: an `isColorValue` value, or `null` to remove; anything else is refused before writing. */
function colorOf(color: ColorValue | null): ColorValue | null {
  if (color !== null && !isColorValue(color))
    throw new RangeError(`Color must be a theme preset or #rrggbb, not ${JSON.stringify(color)}`);
  return color;
}

/** Folder look path: `isFolderPath`; anything else is refused before writing. */
function folderOf(path: string): string {
  if (!isFolderPath(path))
    throw new RangeError(`Folder path must be like TFolder.path, not ${JSON.stringify(path)}`);
  return path;
}

/** Folder icon: `isIconId`, or `null` for the default; anything else is refused before writing. */
function iconOf(icon: string | null): string | null {
  if (icon !== null && !isIconId(icon))
    throw new RangeError(`Icon must be lucide-<name>, not ${JSON.stringify(icon)}`);
  return icon;
}

/** Cover frame: `isCoverFrame`, or `null` for the middle; anything else is refused before writing. */
function frameOf(frame: string | null): string | null {
  if (frame !== null && !isCoverFrame(frame))
    throw new RangeError(`Cover frame must be "x y zoom", not ${JSON.stringify(frame)}`);
  return frame;
}

/** Folder cover: `isCoverName`, or `null` for none; anything else is refused before writing. */
function coverOf(cover: string | null): string | null {
  if (cover !== null && !isCoverName(cover))
    throw new RangeError(`Cover must be a file name in ${COVERS_DIR}, not ${JSON.stringify(cover)}`);
  return cover;
}

/**
 * Paths of folders whose look in index `after` differs from `before`, after reading journals: a look from
 * another device shows even without tagged files.
 */
function looksChanged(before: RecordIndex, after: RecordIndex): string[] {
  const out: string[] = [];
  for (const path of new Set([...before.folderPaths(), ...after.folderPaths()])) {
    const a = before.folderLook(path);
    const b = after.folderLook(path);
    if (a.color !== b.color || a.icon !== b.icon || a.cover !== b.cover || a.frame !== b.frame)
      out.push(path);
  }
  return out;
}

function flagOf(value: boolean): boolean {
  if (typeof value !== 'boolean')
    throw new RangeError(`Flag must be true or false, not ${JSON.stringify(value)}`);
  return value;
}

export function createStore({ io, device, now, statOf }: StoreOptions): Store {
  if (!isDeviceId(device))
    throw new RangeError(`Device id must be 8 characters [a-z0-9], not ${JSON.stringify(device)}`);
  let index = new RecordIndex([]);
  /** Clock: time of the last applied line, own or foreign, ms. */
  let clock = 0;
  /** The device clock went back past the limit: the index holds lines that are now deferred. */
  let behind = false;
  /** Number of deferred lines at the last journal read. */
  let deferred = 0;
  /** Session comment counter, part of the id after the time. */
  let counter = 0;
  const matcher = createMoveMatcher();
  /** Paths with records that disappeared and wait for a pairing partner, with the gone fingerprint. */
  const gone = new Map<string, Fingerprint>();
  /**
   * Paths with records that disappeared without a partner: by event, within the pairing window or after it,
   * or during the check. After journals are read they are checked against foreign moves (`heal`).
   */
  const strays = new Set<string>();
  /**
   * Missing paths with records that wait for their file even after the pairing window: fingerprint key of
   * the gone file -> paths, and path -> key. A file that appears later finds its missing path by key
   * without scanning them all.
   */
  const awaited = new Map<string, Set<string>>();
  const awaitedKey = new Map<string, string>();
  /**
   * Keys for which pairing in the window or the check saw more than one pair: their missing paths do not
   * wait for a late file.
   */
  const contested = new Set<string>();
  const listeners = new Set<(paths: string[]) => void>();
  /** Folder look subscribers: a separate channel. */
  const lookListeners = new Set<(paths: string[]) => void>();
  let queue: Promise<unknown> = Promise.resolve();
  /** Appends in call order: the action queue does not wait for them, journal reads do. */
  let writes: Promise<unknown> = Promise.resolve();
  /**
   * A group waiting for the disk while the previous append runs: journal file -> lines in call order, and the
   * promise of their append. It closes when the disk is free and goes out as one append per file, like
   * LevelDB group commit (`BuildBatchGroup`).
   */
  let group: {
    texts: Map<string, string>;
    written: Map<string, Promise<void>>;
    tail: Promise<unknown>;
  } | null = null;
  /** Append of the lines of the action now running in the queue; that action's promise waits for it. */
  let owed: Promise<void> | null = null;

  /**
   * Actions one at a time: each sees the index after the previous ones, and lines join the write chain in
   * call order. The queue waits only for memory, so a move does not stand behind someone else's append; an
   * action's promise also waits for the append of its lines.
   */
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      try {
        return { value: await task(), written: owed };
      } finally {
        owed = null;
      }
    });
    queue = run.catch(() => undefined);
    return run.then(async ({ value, written }) => {
      await written;
      return value;
    });
  }

  /** Own line time: not before the device clock, after any applied line, at most a day ahead. */
  function tick(t: number): number {
    behind = clock >= t + HORIZON;
    return (clock = Math.min(Math.max(t, clock + 1), t + HORIZON));
  }

  /**
   * Lines go into the group waiting for the disk; without a group a new one is created after the
   * previous appends. A free disk takes lines at once, and while an append runs, lines of later calls
   * pile up, so moving a thousand files takes a few appends rather than a thousand. In the journal file
   * lines follow call order.
   */
  function append(file: string, text: string): Promise<void> {
    const current = (group ??= {
      texts: new Map<string, string>(),
      written: new Map<string, Promise<void>>(),
      tail: writes.then(() => {
        group = null;
      }),
    });
    current.texts.set(file, (current.texts.get(file) ?? '') + text);
    const known = current.written.get(file);
    if (known) return known;
    const written = current.tail.then(() => io.append(file, current.texts.get(file) ?? ''));
    current.written.set(file, written);
    current.tail = writes = written.catch(() => undefined);
    return written;
  }

  /**
   * Lines of one call go into the index and to subscribers at once, then into this device's journal after the
   * previous ones (`append`). If the append fails, journals are read again, memory is left with what is on
   * disk, and the action's promise rejects. If the clock went back past the limit, the index holds lines that
   * are now deferred: the action waits for the append and a journal read.
   */
  function commit(
    t: number,
    actions: (JournalAction | MetaAction)[],
    changed: string[],
    ms = tick(t),
  ): Promise<void> | undefined {
    const at = new Date(ms).toISOString();
    const lines = actions.map((action): KnownLine => ({ v: SCHEMA_VERSION, at, dev: device, ...action }));
    for (const line of lines) index.apply(line);
    // A setting or a declaration of a tag without files changes the tag list, not files: subscribers get an
    // empty path list. Folder looks go to their own subscribers.
    notify(
      changed,
      actions.some(
        (action) => action.op === 'meta.set' && (action.kind === 'group' || action.kind === 'tag'),
      ),
    );
    notifyLooks(
      actions.flatMap((action) => (action.op === 'meta.set' && action.kind === 'folder' ? [action.key] : [])),
    );
    const written = append(journalPath(device, t), lines.map(formatLine).join(''));
    owed = written.catch(async (error: unknown) => {
      await serial(read).catch(() => undefined);
      throw error;
    });
    if (behind) return read();
  }

  /** `always` notifies even without paths: the tag list or tag settings changed. */
  function notify(paths: string[], always = false): void {
    const unique = [...new Set(paths)];
    if (!unique.length && !always) return;
    for (const listener of [...listeners]) {
      try {
        listener(unique);
      } catch (error) {
        console.error('Buba: storage listener failed', error);
      }
    }
  }

  /** Look subscribers get paths of folders whose look changed; not called without paths. */
  function notifyLooks(paths: string[]): void {
    const unique = [...new Set(paths)];
    if (!unique.length) return;
    for (const listener of [...lookListeners]) {
      try {
        listener(unique);
      } catch (error) {
        console.error('Buba: folder look listener failed', error);
      }
    }
  }

  function hasRecords(path: string): boolean {
    const { tags, rating, comments } = index.get(path);
    return (
      tags.length > 0 ||
      rating > 0 ||
      comments.length > 0 ||
      index.link(path) !== null ||
      index.passport(path) !== null ||
      index.referenced(path)
    );
  }

  /**
   * The look of folder `from` moves to `to` whole, all fields, so an old look of a long-deleted folder does
   * not stick to the new path; `from` gets a removal. Exactly the same path, like Obsidian bookmarks:
   * Obsidian sends its own `rename` for nested folders. No look on `from` means no lines: nested files and a
   * repeat of the same rename write nothing. The cover and frame lines go only with a cover or frame: a build
   * before covers reads the move without them.
   */
  function lookMoves(from: string, to: string): MetaAction[] {
    const { color, icon, cover, frame } = index.folderLook(from);
    if ((color === null && icon === null && cover === null && frame === null) || !isFolderPath(to)) return [];
    const out: MetaAction[] = [
      { op: 'meta.set', kind: 'folder', key: to, field: 'color', value: color },
      { op: 'meta.set', kind: 'folder', key: to, field: 'icon', value: icon },
    ];
    if (cover !== null || index.folderLook(to).cover !== null)
      out.push({ op: 'meta.set', kind: 'folder', key: to, field: 'cover', value: cover });
    if (frame !== null || index.folderLook(to).frame !== null)
      out.push({ op: 'meta.set', kind: 'folder', key: to, field: 'frame', value: frame });
    if (color !== null) out.push({ op: 'meta.set', kind: 'folder', key: from, field: 'color', value: null });
    if (icon !== null) out.push({ op: 'meta.set', kind: 'folder', key: from, field: 'icon', value: null });
    if (cover !== null) out.push({ op: 'meta.set', kind: 'folder', key: from, field: 'cover', value: null });
    if (frame !== null) out.push({ op: 'meta.set', kind: 'folder', key: from, field: 'frame', value: null });
    return out;
  }

  /**
   * Own record of a path carries a fresh own fingerprint, which the check uses to find a file moved in the
   * system file manager. If there is none or it is stale (the file was edited while it had no tags, or the
   * path now holds another file), a `file.seen` line is added. Only the own fingerprint is checked: the
   * modification time on another device may differ.
   */
  function withSeen(path: string, actions: JournalAction[]): JournalAction[] {
    return actions.length ? [...seenLine(path), ...actions] : actions;
  }

  /** A `file.seen` line if the own fingerprint of the path is missing or stale; none without a file. */
  function seenLine(path: string): JournalAction[] {
    const stat = statOf(path);
    if (!stat) return [];
    const own = index.seen(path, device);
    if (own && own.size === stat.size && own.mtime === stat.mtime) return [];
    return [{ op: 'file.seen', path, size: stat.size, mtime: stat.mtime }];
  }

  /** The passport with this device's fingerprint of every reference that has a file. */
  function fingerprinted(passport: Passport): Passport {
    if (!passport.refs) return passport;
    return {
      ...passport,
      refs: passport.refs.map((ref) => {
        const stat = statOf(ref.path);
        const name = ref.path.slice(ref.path.lastIndexOf('/') + 1);
        return stat ? { ...ref, fp: { size: stat.size, mtime: stat.mtime, name } } : ref;
      }),
    };
  }

  /** For each path, the lines its record needs now; paths without lines are neither written nor reported. */
  function pathLines(
    paths: readonly string[],
    actions: (path: string) => JournalAction[],
  ): { lines: JournalAction[]; changed: string[] } {
    const lines: JournalAction[] = [];
    const changed: string[] = [];
    for (const path of new Set(paths)) {
      const own = actions(path);
      if (!own.length) continue;
      lines.push(...withSeen(path, own));
      changed.push(path);
    }
    return { lines, changed };
  }

  /** Path lines (`pathLines`) as one write in the action queue. */
  function perPath(
    t: number,
    paths: readonly string[],
    actions: (path: string) => JournalAction[],
  ): Promise<void> {
    return serial(async () => {
      const { lines, changed } = pathLines(paths, actions);
      if (lines.length) await commit(t, lines, changed);
    });
  }

  /**
   * "Birth" lines for the tags of a call: a group with no live tags (neither on files nor declared) loses its
   * old flag and color; a tag that is on no file and is not declared (deleted, or never declared before the
   * update) loses its old color. Settings live by name and outlive the last tag: without this, moving tags
   * one by one into such a name would silently turn on exclusivity and remove tags for good. Only values
   * other than "no settings" are written.
   */
  function reborn(groups: ReadonlySet<string>, tags: readonly string[]): MetaAction[] {
    const out: MetaAction[] = [];
    for (const key of groups) {
      const { exclusive, color } = index.groupSettings(key);
      if (exclusive) out.push({ op: 'meta.set', kind: 'group', key, field: 'exclusive', value: false });
      if (color !== null) out.push({ op: 'meta.set', kind: 'group', key, field: 'color', value: null });
    }
    for (const key of tags)
      if (index.tagColor(key) !== null && !index.inUse('tag', key))
        out.push({ op: 'meta.set', kind: 'tag', key, field: 'color', value: null });
    return out;
  }

  /**
   * Birth of tag `key` by declaration: a group without live tags that has an old flag or color, and a
   * tag without files and without a declaration that has an old color, start with no settings, as on
   * first set (`reborn`).
   */
  function birth(key: string): MetaAction[] {
    const group = groupKey(key);
    const fresh = new Set<string>();
    if (group !== null) {
      const { exclusive, color } = index.groupSettings(group);
      if ((exclusive || color !== null) && !index.inUse('group', group)) fresh.add(group);
    }
    return reborn(fresh, [key]);
  }

  /**
   * A setting as a `meta.set` line if the value differs; subscribers get the files whose tag display it
   * changes. Time and queue as for file actions.
   */
  function setting(action: MetaAction, same: () => boolean, changed: () => string[]): Promise<void> {
    const t = now();
    return serial(async () => {
      if (!same()) await commit(t, [action], changed());
    });
  }

  /** The exclusive group of tag `key`, or `null` (also for a tag without a group). */
  function exclusiveGroup(key: string): string | null {
    const group = groupKey(key);
    return group !== null && index.groupSettings(group).exclusive ? group : null;
  }

  /** Tag declaration lines: key -> spelling. */
  function declarations(tags: ReadonlyMap<string, string>): MetaAction[] {
    return [...tags].map(([key, value]) => ({ op: 'meta.set', kind: 'tag', key, field: 'declared', value }));
  }

  /**
   * What removing tags `list` (key -> spelling of the call) removes from a path: key -> spelling. Hidden tags
   * are removed too; removing a visible tag of an exclusive group takes its hidden neighbours, otherwise
   * removing "done" would reveal a hidden "in progress".
   */
  function removal(path: string, list: ReadonlyMap<string, string>): Map<string, string> {
    const shown = new Set(index.get(path).tags.map(tagKey));
    const present = new Map(index.tagsWithHidden(path).map((tag) => [tagKey(tag) ?? '', tag]));
    const out = new Map<string, string>();
    for (const [key, tag] of list) {
      if (!present.has(key)) continue;
      out.set(key, tag);
      const group = shown.has(key) ? exclusiveGroup(key) : null;
      if (group === null) continue;
      for (const [other, spelled] of present)
        if (other !== key && !out.has(other) && groupKey(other) === group) out.set(other, spelled);
    }
    return out;
  }

  /**
   * Removed tags with no declaration line yet (set before the update) get declared in the same write, in the
   * index spelling, so a tag does not vanish with its last file. A deleted tag (`false`) is not declared.
   */
  function adopt(into: Map<string, string>, removed: Iterable<string>, skip?: string): void {
    for (const key of removed)
      if (key !== skip && !into.has(key) && index.declaration(key) === null)
        into.set(key, index.spelled(key) ?? key);
  }

  /** Move lines for `from` along paths `hops`: one `file.move` line per step. */
  function hopLines(from: string, hops: readonly string[]): JournalAction[] {
    return hops.map((to, i) => ({ op: 'file.move', path: i ? (hops[i - 1] ?? from) : from, to }));
  }

  /**
   * A pairing match: records follow the file, and the record at the new path is replaced, so the
   * moved one wins. A foreign move chain is given as its step paths `hops`, the last being
   * `move.to`: one line per step.
   */
  async function carry(
    t: number,
    move: Move | null,
    hops: readonly string[] = move ? [move.to] : [],
  ): Promise<void> {
    if (!move) return;
    gone.delete(move.from);
    strays.delete(move.from);
    unawait(move.from);
    await commit(t, hopLines(move.from, hops), [move.from, move.to]);
  }

  /** A missing path waits for its file with fingerprint `fp`. */
  function awaitFile(path: string, fp: Fingerprint): void {
    unawait(path);
    const key = fingerprintKey(fp);
    awaitedKey.set(path, key);
    const paths = awaited.get(key);
    if (paths) paths.add(path);
    else awaited.set(key, new Set([path]));
  }

  /** The path no longer waits for a file: the file was found or came back. */
  function unawait(path: string): void {
    const key = awaitedKey.get(path);
    if (key === undefined) return;
    awaitedKey.delete(path);
    const paths = awaited.get(key);
    paths?.delete(path);
    if (!paths?.size) awaited.delete(key);
  }

  /**
   * Fingerprint pairing does not move a record onto a path of its own foreign chain, back to where
   * the journal took it from or halfway: the journal came before the file, and the record stays where
   * the journal moved it.
   */
  function offChain(from: string, to: string): boolean {
    return index.movedTo(to, device)?.at(-1) !== from && !index.movedTo(from, device)?.includes(to);
  }

  /**
   * One file may have different modification times on different devices: a move is checked against the own
   * fingerprint, on the old path or carried along with the record. A newer known size of the source path is
   * not replaced by this older evidence. Without an own fingerprint the last known fingerprint of the
   * source path is used.
   */
  function chainFingerprint(from: string, to: string): Fingerprint | null {
    const latest = index.seen(from);
    const own = index.seen(from, device) ?? index.seen(to, device);
    return latest && own && latest.size !== own.size ? latest : (own ?? latest);
  }

  /**
   * A missing path whose file appeared at `to` later than the pairing window: the only waiting path with
   * this fingerprint among paths with records and no file, and not along its own foreign chain
   * (`offChain`), as in the startup check. There is no pair while a path with records and the same
   * fingerprint is on disk (`twinOnDisk`), or for a key for which pairing or the check saw more than one
   * pair: "missing" is better than another file's tags. Storage does not see a copy without records, so it
   * does not block the pair, even though the startup check would not have paired with it: the cost of
   * fingerprints, the tags go to an identical file.
   */
  function lateFrom(to: string, fp: Fingerprint): string | null {
    const key = fingerprintKey(fp);
    if (contested.has(key)) return null;
    const waiting = [...(awaited.get(key) ?? [])].filter((path) => hasRecords(path) && !statOf(path));
    const [from] = waiting;
    if (from === undefined || waiting.length !== 1 || !offChain(from, to)) return null;
    return twinOnDisk(to, fp) ? null : from;
  }

  /**
   * Besides `to`, a file with fingerprint `fp` is on disk at a path with records: it may still disappear
   * within the pairing window (a system file manager move sends "appeared" and "disappeared" about 100 ms
   * later, see fingerprint.ts), and then the pair is that file, not the missing path. The pairing window
   * decides first. The twin is looked up by file name, without scanning all records.
   */
  function twinOnDisk(to: string, fp: Fingerprint): boolean {
    const key = fingerprintKey(fp);
    return index.named(fp.name).some((path) => {
      if (path === to || !hasRecords(path)) return false;
      const stat = statOf(path);
      return !!stat && fingerprintKey({ size: stat.size, mtime: stat.mtime, name: fp.name }) === key;
    });
  }

  /**
   * After reading journals: a missing path whose record a foreign move or chain took to where the same file
   * already is counts as the same move, with own lines per step, as in the check. This finds a file that
   * arrived under a new name before the journal did: pairing did not recognize it, since the name is part of
   * the key. `chainFingerprint` checks the own fingerprint and the known new size of the source path.
   */
  async function heal(t: number): Promise<void> {
    const moves: (Move & { hops: string[] })[] = [];
    for (const path of strays) {
      const hops = index.movedTo(path, device);
      const to = hops?.at(-1);
      if (!hops || to === undefined || !hasRecords(path) || statOf(path)) continue;
      const known = chainFingerprint(path, to);
      if (known && sameFile(statOf(to), known)) moves.push({ from: path, to, hops });
    }
    if (!moves.length) return;
    for (const { from } of moves) {
      const waiting = gone.get(from);
      // The file was found: stop waiting for a pair, and do not report the path as missing.
      if (waiting && gone.delete(from)) matcher.appeared(from, waiting, t);
      strays.delete(from);
      unawait(from);
    }
    await commit(
      t,
      moves.flatMap(({ from, hops }) => hopLines(from, hops)),
      moves.flatMap(({ from, to }) => [from, to]),
    );
  }

  /**
   * Once the write chain is empty, reads all journals and builds the index without lines more than a day
   * ahead; the clock follows the latest applied line; subscribers get the paths from before and after. A
   * deferred line is applied by a read after its time comes.
   */
  async function read(): Promise<void> {
    await writes;
    const old = index;
    const before = index.paths();
    const cut = new Date(now() + HORIZON).toISOString();
    const journals = sift(await io.readAll(), cut);
    index = new RecordIndex(journals.files);
    clock = journals.latest;
    deferred = journals.deferred;
    notify([...before, ...index.paths()], index.tagSettingsChanged(old));
    notifyLooks(looksChanged(old, index));
  }

  return {
    get: (path) => index.get(path),
    allTags: () => index.allTags(),
    filesWithTag: (tag) => index.filesWithTag(tag),
    untagged: (paths) => index.untagged(paths),
    tagTally: (exists) => index.tagTally(exists),
    groupFiles: (group) => index.groupFiles(group),
    stats: () => ({ ...index.stats(), deferred }),

    // A visible tag writes no lines; a tag of an exclusive group writes `tag.add` plus `tag.remove` for all
    // its group neighbours on the file, hidden ones too; of two tags of one such group in a call, the last
    // one is set. A group without live tags and a tag without files and without a declaration are born with
    // no settings (`reborn`): their `meta.set` lines go in the same write before the tag lines, and such a
    // group is not exclusive in this call. A set tag is declared if it is not; so is a removed neighbour
    // without a declaration line (`adopt`), in the same write.
    async addTags(paths, tags) {
      const list = tagList(tags);
      const t = now();
      return serial(async () => {
        // A group without settings is "born" anyway: the scan over records (`inUse`) runs only for a group
        // with a flag or color.
        const fresh = new Set<string>();
        const checked = new Set<string>();
        for (const [key] of list) {
          const group = groupKey(key);
          if (group === null || checked.has(group)) continue;
          checked.add(group);
          const { exclusive, color } = index.groupSettings(group);
          if ((exclusive || color !== null) && !index.inUse('group', group)) fresh.add(group);
        }
        const exclusiveOf = (key: string): string | null => {
          const group = exclusiveGroup(key);
          return group !== null && !fresh.has(group) ? group : null;
        };
        const last = new Map<string, string>();
        for (const [key] of list) {
          const group = exclusiveOf(key);
          if (group !== null) last.set(group, key);
        }
        const placed = [...list.keys()].filter((key) => {
          const group = exclusiveOf(key);
          return group === null || last.get(group) === key;
        });
        const added = new Set<string>();
        const swapped = new Set<string>();
        const { lines, changed } = pathLines(paths, (path) => {
          const shown = new Set(index.get(path).tags.map(tagKey));
          const present = index.tagsWithHidden(path);
          const actions: JournalAction[] = [];
          for (const key of placed) {
            if (shown.has(key)) continue;
            actions.push({ op: 'tag.add', path, tag: list.get(key) ?? key });
            added.add(key);
            const group = exclusiveOf(key);
            if (group === null) continue;
            for (const other of present) {
              const otherKey = tagKey(other) ?? '';
              if (otherKey === key || groupKey(other) !== group) continue;
              actions.push({ op: 'tag.remove', path, tag: other });
              swapped.add(otherKey);
            }
          }
          return actions;
        });
        if (!lines.length) return;
        const declare = new Map<string, string>();
        for (const key of added) if (index.declaration(key) !== true) declare.set(key, list.get(key) ?? key);
        adopt(declare, swapped);
        await commit(t, [...reborn(fresh, placed), ...declarations(declare), ...lines], changed);
      });
    },

    // Hidden tags are removed too; removing a visible tag of an exclusive group takes its hidden neighbours
    // (`removal`). A removed tag without a declaration line is declared in the same write (`adopt`), so an
    // empty tag does not vanish.
    async removeTags(paths, tags) {
      const list = tagList(tags);
      const t = now();
      return serial(async () => {
        const removed = new Set<string>();
        const { lines, changed } = pathLines(paths, (path) => {
          const out = removal(path, list);
          for (const key of out.keys()) removed.add(key);
          return [...out.values()].map((tag): JournalAction => ({ op: 'tag.remove', path, tag }));
        });
        if (!lines.length) return;
        const declare = new Map<string, string>();
        adopt(declare, removed);
        await commit(t, [...declarations(declare), ...lines], changed);
      });
    },

    declaredTags: () => index.declaredTags(),

    // Declaring: a tag without files and without a declaration is born without old settings, as on first set
    // (`birth`). Removing the declaration: the tag stays while files have it. Subscribers get its files, or
    // an empty list without files.
    async setTagDeclared(tag, declared) {
      const key = metaKey(tag);
      const spelled = normalizeTag(tag) ?? key;
      const value = flagOf(declared);
      const t = now();
      return serial(async () => {
        const state = index.declaration(key);
        if (value ? state === true : state === false) return;
        const actions: MetaAction[] = value
          ? [...birth(key), ...declarations(new Map([[key, spelled]]))]
          : [{ op: 'meta.set', kind: 'tag', key, field: 'declared', value: false }];
        await commit(t, actions, index.touched('tag', key));
      });
    },

    // Deletion is one write: `tag.remove` for every record with the tag, hidden ones and missing files
    // included (`removal`: removing a visible tag of an exclusive group takes its hidden neighbours, and a
    // neighbour without a declaration line gets declared), then removal of the declaration and color. The
    // declaration removal is written even for a tag set before the update, so the deletion takes its place in
    // the common order against a declaration made meanwhile on another device.
    async deleteTag(tag) {
      const key = metaKey(tag);
      const t = now();
      return serial(async () => {
        const list = new Map([[key, index.spelled(key) ?? normalizeTag(tag) ?? key]]);
        const removed = new Set<string>();
        const { lines, changed } = pathLines(index.touched('tag', key), (path) => {
          const out = removal(path, list);
          for (const other of out.keys()) removed.add(other);
          return [...out.values()].map((spelled): JournalAction => ({
            op: 'tag.remove',
            path,
            tag: spelled,
          }));
        });
        const declare = new Map<string, string>();
        adopt(declare, removed, key);
        const state = index.declaration(key);
        const tail: MetaAction[] = [];
        if (state === true || (state === null && lines.length))
          tail.push({ op: 'meta.set', kind: 'tag', key, field: 'declared', value: false });
        if (index.tagColor(key) !== null)
          tail.push({ op: 'meta.set', kind: 'tag', key, field: 'color', value: null });
        if (!lines.length && !tail.length) return;
        await commit(t, [...declarations(declare), ...lines, ...tail], changed);
      });
    },

    groupSettings: (group) => index.groupSettings(group),
    tagColor: (tag) => index.tagColor(tag),
    pinnedColors: () => index.pinnedColors(),
    groupOverlaps: (group) => index.groupOverlaps(group),

    async setGroupExclusive(group, exclusive) {
      const key = metaKey(group);
      const value = flagOf(exclusive);
      return setting(
        { op: 'meta.set', kind: 'group', key, field: 'exclusive', value },
        () => index.groupSettings(key).exclusive === value,
        () => index.touched('group', key),
      );
    },

    async setGroupColor(group, color) {
      const key = metaKey(group);
      const value = colorOf(color);
      return setting(
        { op: 'meta.set', kind: 'group', key, field: 'color', value },
        () => index.groupSettings(key).color === value,
        () => index.touched('group', key),
      );
    },

    async setTagColor(tag, color) {
      const key = metaKey(tag);
      const value = colorOf(color);
      return setting(
        { op: 'meta.set', kind: 'tag', key, field: 'color', value },
        () => index.tagColor(key) === value,
        () => index.touched('tag', key),
      );
    },

    async setColorPinned(color, pinned) {
      if (!isColorValue(color))
        throw new RangeError(`Color must be a theme preset or #rrggbb, not ${JSON.stringify(color)}`);
      const value = flagOf(pinned);
      return setting(
        { op: 'meta.set', kind: 'palette', key: color, field: 'pinned', value },
        () => index.pinnedColors().includes(color) === value,
        () => [],
      );
    },

    link: (path) => index.link(path),

    // A link is a path record like the rating: with the own file fingerprint (`withSeen`);
    // subscribers get the path.
    async setLink(path, url) {
      if (url !== null && !isLinkUrl(url))
        throw new RangeError(`Link must be http:// or https:// only, not ${JSON.stringify(url)}`);
      return perPath(now(), [path], () => (index.link(path) === url ? [] : [{ op: 'link.set', path, url }]));
    },

    passport: (path) => index.passport(path),

    // A passport is checked before the queue, so a refusal never waits for other writes. Its line carries the
    // own fingerprints of the result and of every reference (`file.seen`), so a reference moved in the system
    // file manager is found like a tagged file; subscribers get the result and the references before and after.
    async setPassport(path, raw) {
      let next: Passport | null = null;
      if (raw !== null) {
        const reading = readPassportInput(raw);
        if (!reading.ok) throw new PassportRefused(reading.fault);
        next = reading.passport;
      }
      const t = now();
      return serial(async () => {
        const current = index.passport(path);
        if (passportKey(current) === passportKey(next)) return;
        const gen = next && fingerprinted(next);
        const line: JournalAction = { op: 'gen.set', path, gen };
        const size = new TextEncoder().encode(
          formatLine({ v: SCHEMA_VERSION, at: new Date(t).toISOString(), dev: device, ...line }),
        ).length;
        if (size > LINE_MAX)
          throw new PassportRefused({
            code: 'too-large',
            field: 'passport',
            reason: `takes ${size} bytes, more than ${LINE_MAX}`,
          });
        const refs = refPaths(gen).filter((ref) => ref !== path);
        const lines = [...refs.flatMap(seenLine), ...withSeen(path, [line])];
        await commit(t, lines, [path, ...refPaths(current), ...refs]);
      });
    },

    // Existing files only, newest first: a deleted result comes back with its file.
    usedIn(path) {
      return index
        .usedIn(path)
        .filter((item) => !!statOf(item.path))
        .sort(
          (a, b) =>
            (a.passport.createdAt < b.passport.createdAt
              ? 1
              : a.passport.createdAt > b.passport.createdAt
                ? -1
                : 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
        )
        .map((item) => item.path);
    },

    folderLook: (path) => index.folderLook(path),

    async setFolderColor(path, color) {
      const key = folderOf(path);
      const value = colorOf(color);
      return setting(
        { op: 'meta.set', kind: 'folder', key, field: 'color', value },
        () => index.folderLook(key).color === value,
        () => [],
      );
    },

    async setFolderIcon(path, icon) {
      const key = folderOf(path);
      const value = iconOf(icon);
      return setting(
        { op: 'meta.set', kind: 'folder', key, field: 'icon', value },
        () => index.folderLook(key).icon === value,
        () => [],
      );
    },

    async setFolderCover(path, cover) {
      const key = folderOf(path);
      const value = coverOf(cover);
      return setting(
        { op: 'meta.set', kind: 'folder', key, field: 'cover', value },
        () => index.folderLook(key).cover === value,
        () => [],
      );
    },

    async setFolderFrame(path, frame) {
      const key = folderOf(path);
      const value = frameOf(frame);
      return setting(
        { op: 'meta.set', kind: 'folder', key, field: 'frame', value },
        () => index.folderLook(key).frame === value,
        () => [],
      );
    },

    coverInUse: (name) => index.folderPaths().some((path) => index.folderLook(path).cover === name),

    onFolderLook(listener) {
      lookListeners.add(listener);
      return () => {
        lookListeners.delete(listener);
      };
    },

    async setRating(paths, rating) {
      if (!Number.isInteger(rating) || rating < 0 || rating > 5)
        throw new RangeError(`Rating must be a whole number from 0 to 5, not ${rating}`);
      return perPath(now(), paths, (path) =>
        index.get(path).rating === rating ? [] : [{ op: 'rating.set', path, rating }],
      );
    },

    async addComment(path, text) {
      if (!text.trim()) throw new RangeError('Empty comment');
      const t = now();
      return serial(async () => {
        const ms = tick(t);
        const comment: FileComment = {
          id: `${device}-${ms.toString(36)}-${counter++}`,
          text,
          at: new Date(ms).toISOString(),
          device,
        };
        await commit(t, withSeen(path, [{ op: 'comment.add', path, id: comment.id, text }]), [path], ms);
        return comment;
      });
    },

    async removeComment(path, id) {
      return perPath(now(), [path], () =>
        index.get(path).comments.some((comment) => comment.id === id)
          ? [{ op: 'comment.remove', path, id }]
          : [],
      );
    },

    // The same flag is not written again: two quick clicks before the panel redraws give one line.
    async setCommentDone(path, id, done) {
      return perPath(now(), [path], () =>
        index.get(path).comments.some((comment) => comment.id === id && (comment.done ?? false) !== done)
          ? [{ op: 'comment.done', path, id, done }]
          : [],
      );
    },

    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    load: () => serial(read),
    // Another device's journals may have moved a missing path's record to where the file already is (`heal`).
    reload() {
      const t = now();
      return serial(async () => {
        await read();
        await heal(t);
      });
    },

    // A path without records asks the index folder counter, so a series of renames without records does not
    // scan the index. The folder look goes in the same write (`lookMoves`).
    async fileRenamed(from, to) {
      const t = now();
      return serial(async () => {
        if (from === to) return;
        const looks = lookMoves(from, to);
        let moved = hasRecords(from) ? [from] : [];
        if (!moved.length && index.holds(from))
          moved = index.paths().filter((path) => path.startsWith(`${from}/`));
        if (!moved.length && !looks.length) return;
        const actions: (JournalAction | MetaAction)[] = moved.length
          ? [{ op: 'file.move', path: from, to }]
          : [];
        const changed = moved.flatMap((path) => [path, to + path.slice(from.length)]);
        await commit(t, [...actions, ...looks], changed);
      });
    },

    // Only paths with records and files without records go into pairing. A file that came back to its own
    // path leaves the records alone and stops waiting for a pair: otherwise a copy with the same fingerprint
    // would take its records. If another device's journals know a move of an old path here (or a chain of
    // moves through empty paths), the old path has its own records and no file, and the arriving file is the
    // one that was there, then sync delivered the same move: own lines per step, and the old path's records
    // merge with the moved ones (record-index.ts, `move`). Sameness is checked by `chainFingerprint`, or by
    // the gone file's fingerprint when the journal has none (the device tagged the file before the foreign
    // move, and a new record on the old path does not write its own fingerprint). This does not wait for the
    // pairing window: the journal knows the move however long the file takes. A move the journal does not
    // know goes by fingerprint: within the pairing window as an event pair, later as a missing path waiting
    // for its file (`lateFrom`), with the same line as the startup check.
    async fileAppeared(path, fp) {
      const t = now();
      return serial(async () => {
        const from = index.movedFrom(path, device).at(-1) ?? null;
        const old = from === null ? null : (chainFingerprint(from, path) ?? gone.get(from));
        const hops = from === null ? null : index.movedTo(from, device);
        if (
          from !== null &&
          hops?.at(-1) === path &&
          hasRecords(from) &&
          !statOf(from) &&
          sameFile(old, fp)
        ) {
          if (gone.delete(from)) matcher.appeared(from, fp, t);
          return carry(t, { from, to: path }, hops);
        }
        if (!hasRecords(path)) {
          const late = { from: null as string | null };
          const move = matcher.appeared(path, fp, t, () => (late.from = lateFrom(path, fp)));
          if (!move) {
            if (matcher.contested(fp)) contested.add(fingerprintKey(fp));
            return;
          }
          const chain = index.movedTo(move.from, device);
          const source = chainFingerprint(move.from, chain?.at(-1) ?? move.to);
          if (source && !sameFile(source, fp) && chain) return;
          // The pairing window no longer holds the late path, but the timer may not have
          // reported it as missing yet.
          const waiting = move.from === late.from ? gone.get(move.from) : undefined;
          if (waiting && gone.delete(move.from)) matcher.appeared(move.from, waiting, t);
          return carry(t, move);
        }
        unawait(path);
        if (gone.delete(path)) matcher.appeared(path, fp, t);
      });
    },

    // If another device's journals moved this path's record (by a move or chain) to where the same file that
    // disappeared already is, it is the same move: own lines per step. A different file at the destination is
    // not it, and pairing looks for a partner. Without a pair the path waits for its file even after the
    // window; rivals in the window make the key contested.
    async fileDisappeared(path, fp) {
      const t = now();
      return serial(async () => {
        if (!hasRecords(path)) return;
        const hops = index.movedTo(path, device);
        const to = hops?.at(-1);
        const source = chainFingerprint(path, to ?? path);
        if (hops && to !== undefined && sameFile(statOf(to), fp) && (!source || sameFile(source, fp)))
          return carry(t, { from: path, to }, hops);
        const move = !hops || !source || sameFile(source, fp) ? matcher.disappeared(path, fp, t) : null;
        // While the candidate waited for its partner to disappear, the user may have added tags or other
        // records to it. It is no longer a pairing target: both records stay on their own paths.
        if (move && !hasRecords(move.to)) return carry(t, move);
        gone.set(path, fp);
        strays.add(path);
        awaitFile(path, fp);
        if (matcher.contested(fp)) contested.add(fingerprintKey(fp));
      });
    },

    // The own fingerprint is written when it is missing or differs: a change is an event of this
    // device, one line per edit.
    async fileChanged(path, fp) {
      const t = now();
      return serial(async () => {
        if (!hasRecords(path)) return;
        const own = index.seen(path, device);
        if (own && own.size === fp.size && own.mtime === fp.mtime) return;
        await commit(t, [{ op: 'file.seen', path, size: fp.size, mtime: fp.mtime }], []);
      });
    },

    // At startup: a missing path with records that another device's journals moved (by a move or chain) to
    // where the same file is counts as the same move, own lines per step, as on the event path
    // (`fileDisappeared`); `chainFingerprint` picks the fingerprint. Other missing paths are matched against
    // files without records, except the paths of such moves (a record without tags is not visible in
    // `paths()`, and pairing would hand its path to a second file), by own fingerprint, or without one by the
    // latest from any device; a present file whose own fingerprint changed gets a line. Pairing does not move
    // a record onto a path of its own foreign chain, back or halfway: the journal came before the file and
    // the record stays where the journal put it; events will find the file when it arrives, and a file moved
    // back by hand is paired by the device that recorded the move. The remaining missing paths wait for a
    // foreign move on journal read (`heal`) and for their own file arriving later, if no file with their
    // fingerprint exists now; otherwise the pair is contested. The check does not mark a file without its own
    // fingerprint: otherwise the first run on a new device would write a line for every file with records.
    async reconcile(files) {
      const t = now();
      return serial(async () => {
        const recorded = new Set(index.paths());
        const present = new Map(files.map(({ path, fp }) => [path, fp]));
        const missing: FingerprintedFile[] = [];
        const carried: (Move & { hops: string[] })[] = [];
        for (const path of recorded) {
          if (present.has(path)) continue;
          const hops = index.movedTo(path, device);
          const to = hops?.at(-1);
          const there = to === undefined ? undefined : present.get(to);
          if (hops && to !== undefined && there && sameFile(chainFingerprint(path, to), there)) {
            carried.push({ from: path, to, hops });
            continue;
          }
          strays.add(path);
          // A foreign chain is not followed by an old own fingerprint when a newer size is known. Without a
          // chain the plain check keeps preferring the own fingerprint.
          const fp = hops
            ? chainFingerprint(path, to ?? path)
            : (index.seen(path, device) ?? index.seen(path));
          if (fp) missing.push({ path, fp });
        }
        const targets = new Set(carried.map(({ to }) => to));
        const candidates = files.filter(({ path }) => !recorded.has(path) && !targets.has(path));
        const glued = matchMissing(missing, candidates).filter(({ from, to }) => offChain(from, to));
        const found = new Set(glued.map(({ from }) => from));
        const offered = new Set(candidates.map(({ fp }) => fingerprintKey(fp)));
        for (const { path, fp } of missing) {
          if (found.has(path)) continue;
          if (offered.has(fingerprintKey(fp))) contested.add(fingerprintKey(fp));
          else awaitFile(path, fp);
        }
        const moves = [...carried, ...glued];
        const actions: JournalAction[] = [
          ...carried.flatMap(({ from, hops }) => hopLines(from, hops)),
          ...glued.map(({ from, to }): JournalAction => ({ op: 'file.move', path: from, to })),
        ];
        for (const { path, fp } of files) {
          const own = recorded.has(path) ? index.seen(path, device) : null;
          if (own && (own.size !== fp.size || own.mtime !== fp.mtime))
            actions.push({ op: 'file.seen', path, size: fp.size, mtime: fp.mtime });
        }
        for (const { from } of moves) {
          gone.delete(from);
          strays.delete(from);
          unawait(from);
        }
        const changed = moves.flatMap(({ from, to }) => [from, to]);
        if (actions.length) await commit(t, actions, changed);
      });
    },

    async expire() {
      const t = now();
      return serial(async () => {
        const lost = matcher.expire(t).map(({ path }) => path);
        for (const path of lost) gone.delete(path);
        return lost;
      });
    },
  };
}
