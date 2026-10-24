// Combined index of tags, ratings, comments and fingerprints from the journals of all devices. Lines of all
// devices go in one order (time, device, position of the line in the device's files, files by name, i.e.
// months in order), and the index is their fold: the same order on every device gives the same index. The
// rules are CRDT (Shapiro et al., INRIA RR-7506, https://inria.hal.science/inria-00555588): for a (path, tag)
// pair and for the rating the last action wins (LWW), and a removed comment never comes back (tombstone by
// id). A move travels with the record, not the path: the same move recorded by a second device merges records
// instead of replacing them, so edits it made on the old path before it learned of the first device's move
// travel with the file (Kleppmann et al., "A highly-available move operation for replicated trees", 2021,
// https://martin.kleppmann.com/papers/move-op.pdf).
//
// Group and tag settings (`meta.set`) are also LWW in the same order; of the tags of an exclusive group a
// file shows the last one set, the index keeps the others hidden, and they show again once the flag is turned
// off. A tag declaration is LWW too: a declared tag stays in the tag list even without files.
//
// Chains of foreign moves: the index remembers which move took a record off a path and which brought it to a
// path, and follows a chain P->Q->R to its end, so a device that did not know about the moves carries its
// old-path records forward step by step. The same move as one step P->R, recorded by other devices as a
// chain, merges records just like a move of the same path.
//
// A file's link (`link.set`) lives in the path record like the rating: LWW, travels with the record. Folder
// look (`meta.set` of kind `folder`) is keyed by folder path, LWW per field, and does not travel with
// records.
//
// A generation passport (`gen.set`) lives in the path record like the link: LWW, travels with the
// record. Its references are vault paths: every reference path is a record too, so its file is moved and
// checked like a tagged one, and a `file.move` of a reference (or of a folder above it) rewrites the path in
// every passport that names it, in memory; journals keep what was written. The reverse index "reference ->
// passports" is kept in memory along with the fold. The index never writes journals: its only input is file
// text.
import type { ColorValue } from '../color/value.ts';
import { groupKey } from '../tags/groups.ts';
import { formatLine, parseLine, type ParsedLine } from './journal.ts';
import { refPaths, type Passport } from './passport.ts';
import {
  normalizeTag,
  tagKey,
  type BubaStorage,
  type FileComment,
  type FileRecord,
  type Fingerprint,
  type FolderLook,
  type GroupSettings,
  type KnownLine,
  type Rating,
  type TagCount,
  type TagTally,
} from './types.ts';

/**
 * A record move: from which path, to which, and which devices recorded it. One or two devices are kept as a
 * comma-separated string rather than a set: a folder move has one hop for all its records, a chain should not
 * hold a set per step, and the same move is usually written by two devices, desktop and phone (memory grows
 * by at most 6%). From the third device on it is a set, so the "did it record" check does not grow with the
 * device count, and a hostile journal with the same move from thousands of devices cannot hang the fold.
 */
interface Hop {
  path: string;
  to: string;
  devices: string | Set<string>;
}

/**
 * Step limit for a chain of foreign moves: a real chain is a few moves made while the device was closed; a
 * longer one is a hostile journal (external input), and the records stay in place as without a chain. Move
 * maps have no loops (a move onto a path clears the earlier move from it), but the limit would cut one too.
 */
const MAX_HOPS = 64;

/** Whether the device recorded the move. */
function recorded(hop: Hop, device: string): boolean {
  const { devices } = hop;
  if (typeof devices !== 'string') return devices.has(device);
  const comma = devices.indexOf(',');
  if (comma < 0) return devices === device;
  return (
    (comma === device.length && devices.startsWith(device)) ||
    (devices.length - comma - 1 === device.length && devices.endsWith(device))
  );
}

/** The device also recorded this move: the second goes into the string, from the third on it is a set. */
function record(hop: Hop, device: string): void {
  if (recorded(hop, device)) return;
  const { devices } = hop;
  if (typeof devices !== 'string') devices.add(device);
  else if (devices.includes(',')) hop.devices = new Set([...devices.split(','), device]);
  else hop.devices = `${devices},${device}`;
}

interface Entry {
  /** Tag keys (`tagKey`) in the order set -> fold step of the tag's last `tag.add` line. */
  tags: Map<string, number>;
  rating: Rating;
  /** Fold step of the `rating.set` line; -1 if no rating was set. */
  rated: number;
  comments: Map<string, FileComment>;
  /** Last path fingerprint per device and the fold step of its line; the most recent comes last. */
  seen: Map<string, { size: number; mtime: number; step: number }>;
  /** The last move that brought the record here; `null` if it was created on its own path. */
  from: Hop | null;
  /** A file's link; `null` if never set or removed. */
  link: string | null;
  /** Fold step of the `link.set` line; -1 if no link was set. */
  linked: number;
  /** A generation passport, its reference paths following moves; `null` if never set or removed. */
  gen: Passport | null;
  /** Fold step of the `gen.set` line; -1 if no passport was set. */
  genStep: number;
  /** The path the record is on now: a reference finds the files whose passports name it. */
  home: string;
}

/** `seq` is the line's position: files by name, lines of a file in order; an own new line comes after all. */
interface Placed {
  line: KnownLine;
  seq: number;
}

/** Comparison by character codes: no locale, the same on any device. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The common line order: time (`toISOString()` compares as text), device, line position. */
const order = (a: Placed, b: Placed): number =>
  compare(a.line.at, b.line.at) || compare(a.line.dev, b.line.dev) || a.seq - b.seq;

/** Tag names alphabetically, numbers by value: "Clip 2" before "Clip 10". */
const byName = new Intl.Collator(undefined, { numeric: true });

export class RecordIndex implements Pick<
  BubaStorage,
  | 'get'
  | 'allTags'
  | 'filesWithTag'
  | 'untagged'
  | 'groupSettings'
  | 'tagColor'
  | 'pinnedColors'
  | 'groupOverlaps'
> {
  private lines: Placed[] = [];
  private seq = 0;
  private unknown = 0;
  private broken = 0;
  private entries = new Map<string, Entry>();
  /**
   * Folder -> number of records under it, so a file move does not scan all records, and a folder move only
   * when something is under it (like `#folders` in `src/platform/files/file-index.ts`). A folder is any path
   * prefix up to a `/`, including the empty one: that way "path under `from/`" matches `startsWith`, even for
   * paths from foreign journals with a leading `/` or a `//` inside.
   */
  private under = new Map<string, number>();
  /**
   * File name -> paths of records with that name: a late file looks for its twin by name without scanning all
   * records (like `MetadataCache.uniqueFileLookup` in Obsidian). The name is the part of the path after the
   * last `/`, or the whole path without `/`. One path is a string, from the second on a set: a set for every
   * name would add 16% memory to the index instead of 4%.
   */
  private byName = new Map<string, string | Set<string>>();
  /** Tombstones: ids of removed comments, on any path. */
  private removed = new Set<string>();
  /**
   * Done flags: comment id -> flag of the last `comment.done` line in the common order. By id, like
   * tombstones, so the flag survives a file move and record merges.
   */
  private done = new Map<string, boolean>();
  /** Tag spelling, from its first record. */
  private spelling = new Map<string, string>();
  /** Path -> the last move that took its record away. */
  private moved = new Map<string, Hop>();
  /** Path -> the last move that brought a record here; a record created anew on the path clears it. */
  private came = new Map<string, Hop>();
  /** Keys of exclusive groups. */
  private exclusive = new Set<string>();
  /** Group and tag colors: `group:<key>` or `tag:<key>` -> color. */
  private colors = new Map<string, ColorValue>();
  /** Pinned colors -> fold step of the pinning line. */
  private pinned = new Map<ColorValue, number>();
  /**
   * Tag declarations: key -> `true` declared, `false` deleted; no key if there was no declaration line. The
   * spelling of a declared tag is in `spelling`.
   */
  private declared = new Map<string, boolean>();
  /** Folder looks: folder path -> color and icon; no key if there is no look. */
  private looks = new Map<string, FolderLook>();
  /** Reference path -> records whose passport names it. */
  private refs = new Map<string, Set<Entry>>();
  /**
   * Folder -> number of reference paths under it, like `under`: a move of a folder without references does
   * not scan them.
   */
  private refUnder = new Map<string, number>();
  /** Tag key -> its group key; independent of journals and not cleared on rebuild. */
  private groups = new Map<string, string | null>();
  /**
   * Fold step: lines in the common order; an own new line always comes after all, so the step
   * equals the one on rebuild.
   */
  private step = 0;

  /** Journal files as `JournalIO.readAll()` returns them; input file order does not matter. */
  constructor(files: readonly { file: string; text: string }[]) {
    const byFile = [...files].sort((a, b) => compare(a.file, b.file));
    for (const { text } of byFile)
      for (const raw of text.split('\n')) if (raw.trim()) this.take(parseLine(raw));
    this.rebuild();
  }

  /**
   * An own new line appended to this device's journal, without a rebuild. If the device clock is behind
   * foreign lines already read, the line lands in the middle of the order and the fold runs again: otherwise
   * this index would diverge from other devices' indexes. A line the parser would not accept is only
   * counted, as on rebuild.
   */
  apply(line: KnownLine): void {
    const last = this.lines.at(-1);
    const placed = this.take(parseLine(formatLine(line)));
    if (!placed) return;
    if (!last || order(last, placed) < 0) this.fold(placed.line);
    else this.rebuild();
  }

  /** File record with visible tags; empty if there are no records. */
  get(path: string): FileRecord {
    const entry = this.entries.get(path);
    if (!entry) return { tags: [], rating: 0, comments: [] };
    return {
      tags: this.visible(entry).map((key) => this.spelling.get(key) ?? key),
      rating: entry.rating,
      comments: this.comments(entry),
    };
  }

  /** File tags including those hidden by exclusivity, in the order set. */
  tagsWithHidden(path: string): string[] {
    return [...(this.entries.get(path)?.tags.keys() ?? [])].map((key) => this.spelling.get(key) ?? key);
  }

  /**
   * All visible tags with file counts, plus declared tags without visible files with count 0: by count
   * descending, then by name.
   */
  allTags(): TagCount[] {
    const counts = new Map<string, number>();
    for (const entry of this.entries.values())
      for (const key of this.visible(entry)) counts.set(key, (counts.get(key) ?? 0) + 1);
    for (const [key, on] of this.declared) if (on && !counts.has(key)) counts.set(key, 0);
    return [...counts]
      .map(([key, count]) => ({ tag: this.spelling.get(key) ?? key, count }))
      .sort((a, b) => b.count - a.count || byName.compare(a.tag, b.tag));
  }

  /** Declared tags in the index spelling, with and without files. */
  declaredTags(): string[] {
    return [...this.declared].filter(([, on]) => on).map(([key]) => this.spelling.get(key) ?? key);
  }

  /** Tag spelling from its first record; `null` if there are no records of it. */
  spelled(tag: string): string | null {
    const key = tagKey(tag);
    return key === null ? null : (this.spelling.get(key) ?? null);
  }

  /** Declared (`true`), deleted (`false`) or no declaration line (`null`); case-insensitive. */
  declaration(tag: string): boolean | null {
    const key = tagKey(tag);
    return key === null ? null : (this.declared.get(key) ?? null);
  }

  /**
   * Whether tag declarations or tag and group settings changed; folder looks have their own
   * notification channel.
   */
  tagSettingsChanged(before: RecordIndex): boolean {
    if (
      this.declared.size !== before.declared.size ||
      this.exclusive.size !== before.exclusive.size ||
      this.colors.size !== before.colors.size
    )
      return true;
    for (const [key, on] of this.declared)
      if (before.declared.get(key) !== on || (on && this.spelling.get(key) !== before.spelling.get(key)))
        return true;
    for (const key of this.exclusive) if (!before.exclusive.has(key)) return true;
    for (const [key, color] of this.colors) if (before.colors.get(key) !== color) return true;
    return false;
  }

  /** Files on which the tag is visible; case-insensitive. */
  filesWithTag(tag: string): string[] {
    const key = tagKey(tag);
    if (key === null) return [];
    return [...this.entries].filter(([, entry]) => this.shows(entry, key)).map(([path]) => path);
  }

  /**
   * Counts for the "All tags" tree from records of files that exist (`exists`), in one pass over keys without
   * building a file record per path: visible tags of a record -> count, the group key comes from the memoized
   * `group()`, and a group counts once per file. Declared tags without visible files get count 0, and so does
   * their group. Spellings and group members are resolved at the end, once per tag.
   */
  tagTally(exists: (path: string) => boolean): TagTally {
    const counts = new Map<string, number>();
    const groups = new Map<string, number>();
    const counted = new Set<string>();
    for (const [path, entry] of this.entries) {
      if (!entry.tags.size || !exists(path)) continue;
      counted.clear();
      for (const key of this.visible(entry)) {
        // An empty tag from a foreign journal is not a tag, as in `tagKey`.
        if (!key) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        const group = this.group(key);
        if (group === null || counted.has(group)) continue;
        counted.add(group);
        groups.set(group, (groups.get(group) ?? 0) + 1);
      }
    }
    for (const [key, on] of this.declared) if (on && key && !counts.has(key)) counts.set(key, 0);
    const tags: TagCount[] = [];
    const members = new Map<string, string[]>();
    for (const [key, count] of counts) {
      const tag = this.spelling.get(key) ?? key;
      tags.push({ tag, count });
      const group = this.group(key);
      if (group === null) continue;
      if (!groups.has(group)) groups.set(group, 0);
      const names = members.get(group);
      if (names) names.push(tag);
      else members.set(group, [tag]);
    }
    return { tags, groups, members };
  }

  /**
   * Files with any visible tag of the group; case-insensitive. At least one group tag is visible whenever
   * one is set: exclusivity leaves the last one visible, and another group does not hide them, so a pass
   * over keys is enough.
   */
  groupFiles(group: string): string[] {
    const own = tagKey(group);
    if (own === null) return [];
    const out: string[] = [];
    for (const [path, entry] of this.entries)
      for (const key of entry.tags.keys())
        if (this.group(key) === own) {
          out.push(path);
          break;
        }
    return out;
  }

  /** Those of `paths` that have no tags; a file with tags always shows at least one. */
  untagged(paths: readonly string[]): string[] {
    return paths.filter((path) => !this.entries.get(path)?.tags.size);
  }

  /** Group settings; case-insensitive. */
  groupSettings(group: string): GroupSettings {
    const key = tagKey(group);
    if (key === null) return { exclusive: false, color: null };
    return { exclusive: this.exclusive.has(key), color: this.colors.get(`group:${key}`) ?? null };
  }

  /** Tag color; `null` if never set or removed. */
  tagColor(tag: string): ColorValue | null {
    const key = tagKey(tag);
    return key === null ? null : (this.colors.get(`tag:${key}`) ?? null);
  }

  /** Pinned colors in the order of their pinning lines: pinned earlier comes first. */
  pinnedColors(): ColorValue[] {
    return [...this.pinned.entries()].sort(([, a], [, b]) => a - b).map(([color]) => color);
  }

  /** Files with more than one tag of the group, hidden ones included. */
  groupOverlaps(group: string): string[] {
    const key = tagKey(group);
    if (key === null) return [];
    return [...this.entries]
      .filter(([, entry]) => [...entry.tags.keys()].filter((tag) => this.group(tag) === key).length > 1)
      .map(([path]) => path);
  }

  /**
   * Files with tag `key` or, with `kind: 'group'`, with any tag of group `key`, hidden ones included: those
   * whose tag display the setting changes.
   */
  touched(kind: 'group' | 'tag', key: string): string[] {
    const own = tagKey(key);
    if (own === null) return [];
    const hit = (tag: string) => (kind === 'tag' ? tag === own : this.group(tag) === own);
    return [...this.entries].filter(([, entry]) => [...entry.tags.keys()].some(hit)).map(([path]) => path);
  }

  /**
   * Whether tag `key` or, with `kind: 'group'`, any tag of group `key` is alive: declared or set on some
   * file, hidden ones included. Declarations are checked before records; the pass over records stops at the
   * first hit, so it is short for a tag that exists.
   */
  inUse(kind: 'group' | 'tag', key: string): boolean {
    const own = tagKey(key);
    if (own === null) return false;
    for (const [tag, on] of this.declared)
      if (on && (kind === 'tag' ? tag === own : this.group(tag) === own)) return true;
    for (const entry of this.entries.values())
      for (const tag of entry.tags.keys())
        if (kind === 'tag' ? tag === own : this.group(tag) === own) return true;
    return false;
  }

  /** A file's link; `null` if never set or removed. */
  link(path: string): string | null {
    return this.entries.get(path)?.link ?? null;
  }

  /** A file's generation passport, reference paths as they are now; `null` if there is none. */
  passport(path: string): Passport | null {
    return this.entries.get(path)?.gen ?? null;
  }

  /** Whether a passport names the path as a reference. */
  referenced(path: string): boolean {
    return this.refs.has(path);
  }

  /** Records whose passport names `path` as a reference: their paths and passports, in no set order. */
  usedIn(path: string): { path: string; passport: Passport }[] {
    const out: { path: string; passport: Passport }[] = [];
    for (const entry of this.refs.get(path) ?? [])
      if (entry.gen) out.push({ path: entry.home, passport: entry.gen });
    return out;
  }

  /** Folder look by its path; both fields `null` if there is none. */
  folderLook(path: string): FolderLook {
    const look = this.looks.get(path);
    return { color: look?.color ?? null, icon: look?.icon ?? null };
  }

  /** Paths of folders with a look. */
  folderPaths(): string[] {
    return [...this.looks.keys()];
  }

  /**
   * Whether there are records or passport references under folder `folder/`, without scanning records;
   * records without tags, rating and comments count too.
   */
  holds(folder: string): boolean {
    return this.under.has(folder) || this.refUnder.has(folder);
  }

  /**
   * Paths of records with file name `name`, without scanning records; records without tags, rating
   * and comments count too.
   */
  named(name: string): string[] {
    const held = this.byName.get(name);
    return held === undefined ? [] : typeof held === 'string' ? [held] : [...held];
  }

  /** Paths that have tags, a rating, comments, a link or a passport, or that a passport names as a reference. */
  paths(): string[] {
    return [...this.entries]
      .filter(
        ([path, entry]) =>
          entry.tags.size > 0 ||
          entry.rating > 0 ||
          entry.link !== null ||
          entry.gen !== null ||
          this.refs.has(path) ||
          this.comments(entry).length > 0,
      )
      .map(([path]) => path);
  }

  /**
   * Last fingerprint of the path from device `device`, or without it the most recent from any; the name
   * comes from the path.
   */
  seen(path: string, device?: string): Fingerprint | null {
    const seen = this.entries.get(path)?.seen;
    const last = device === undefined ? [...(seen?.values() ?? [])].at(-1) : seen?.get(device);
    return last ? { size: last.size, mtime: last.mtime, name: path.slice(path.lastIndexOf('/') + 1) } : null;
  }

  /**
   * Paths the record of `path` was carried along by consecutive moves that device `device` did not record,
   * nearest first, the last being where it is now; otherwise `null`. An intermediate path must be empty (no
   * record on it and no records under it as a folder, since a step line from it would carry those too), and
   * the record must have arrived there by exactly this step; the final record was brought by the last step.
   * The device knew its own move: its records on the old path after that move are about another file. More
   * than `MAX_HOPS` steps gives `null`.
   */
  movedTo(path: string, device: string): string[] | null {
    const hops: string[] = [];
    for (let hop = this.moved.get(path); hop && !recorded(hop, device); hop = this.moved.get(hop.to)) {
      if (hops.length === MAX_HOPS) return null;
      hops.push(hop.to);
      const there = this.entries.get(hop.to);
      if (there) return there.from === hop ? hops : null;
      if (this.came.get(hop.to) !== hop || this.under.has(hop.to)) return null;
    }
    return null;
  }

  /**
   * Paths from which consecutive moves that device `device` did not record brought the record of `path`,
   * nearest first, the last being the first path that has a record. Empty if the chain does not reach one (a
   * step recorded by this device, the path was later moved away by another move, records under an
   * intermediate path, more than `MAX_HOPS` steps).
   */
  movedFrom(path: string, device: string): string[] {
    const paths: string[] = [];
    for (
      let hop = this.entries.get(path)?.from;
      hop && !recorded(hop, device);
      hop = this.came.get(hop.path)
    ) {
      if (this.moved.get(hop.path) !== hop || paths.length === MAX_HOPS) return [];
      paths.push(hop.path);
      if (this.entries.has(hop.path)) return paths;
      if (this.under.has(hop.path)) return [];
    }
    return [];
  }

  /** Line counts: applied, plus skipped unknown and broken ones. */
  stats(): { lines: number; unknown: number; broken: number } {
    return { lines: this.lines.length, unknown: this.unknown, broken: this.broken };
  }

  private take(parsed: ParsedLine): Placed | null {
    if (parsed.kind === 'unknown') this.unknown++;
    if (parsed.kind === 'broken') this.broken++;
    if (parsed.kind !== 'line') return null;
    const placed = { line: parsed.line, seq: this.seq++ };
    this.lines.push(placed);
    return placed;
  }

  private rebuild(): void {
    this.lines.sort(order);
    this.entries = new Map();
    this.under = new Map();
    this.byName = new Map();
    this.removed = new Set();
    this.done = new Map();
    this.spelling = new Map();
    this.moved = new Map();
    this.came = new Map();
    this.exclusive = new Set();
    this.colors = new Map();
    this.pinned = new Map();
    this.declared = new Map();
    this.looks = new Map();
    this.refs = new Map();
    this.refUnder = new Map();
    this.step = 0;
    for (const { line } of this.lines) this.fold(line);
  }

  private fold(line: KnownLine): void {
    const step = this.step++;
    switch (line.op) {
      case 'tag.add': {
        const key = tagKey(line.tag) ?? '';
        if (!this.spelling.has(key)) this.spelling.set(key, normalizeTag(line.tag) ?? key);
        this.entry(line.path).tags.set(key, step);
        break;
      }
      case 'tag.remove':
        this.entries.get(line.path)?.tags.delete(tagKey(line.tag) ?? '');
        break;
      case 'rating.set': {
        const entry = this.entry(line.path);
        entry.rating = line.rating;
        entry.rated = step;
        break;
      }
      case 'comment.add': {
        const { comments } = this.entry(line.path);
        if (!comments.has(line.id))
          comments.set(line.id, { id: line.id, text: line.text, at: line.at, device: line.dev });
        break;
      }
      case 'comment.remove':
        this.removed.add(line.id);
        break;
      case 'comment.done':
        this.done.set(line.id, line.done);
        break;
      case 'file.move':
        this.move(line.path, line.to, line.dev);
        break;
      case 'file.seen': {
        const { seen } = this.entry(line.path);
        seen.delete(line.dev);
        seen.set(line.dev, { size: line.size, mtime: line.mtime, step });
        break;
      }
      case 'link.set': {
        const entry = this.entry(line.path);
        entry.link = line.url;
        entry.linked = step;
        break;
      }
      case 'gen.set': {
        const entry = this.entry(line.path);
        this.unlinkRefs(entry);
        entry.gen = line.gen;
        entry.genStep = step;
        this.linkRefs(entry);
        // A reference is a record: its file is moved and checked like a tagged one.
        for (const path of refPaths(line.gen)) this.entry(path);
        break;
      }
      case 'meta.set':
        if (line.kind === 'folder') {
          const { color, icon } = this.folderLook(line.key);
          const look = line.field === 'color' ? { color: line.value, icon } : { color, icon: line.value };
          if (look.color === null && look.icon === null) this.looks.delete(line.key);
          else this.looks.set(line.key, look);
        } else if (line.kind === 'palette') {
          if (line.value) this.pinned.set(line.key, step);
          else this.pinned.delete(line.key);
        } else {
          const key = tagKey(line.key) ?? '';
          if (line.field === 'declared') {
            // The spelling comes from the tag's first record, and a declaration is a record too.
            if (line.value !== false && !this.spelling.has(key)) this.spelling.set(key, line.value);
            this.declared.set(key, line.value !== false);
          } else if (line.field === 'exclusive') {
            if (line.value) this.exclusive.add(key);
            else this.exclusive.delete(key);
          } else if (line.value === null) this.colors.delete(`${line.kind}:${key}`);
          else this.colors.set(`${line.kind}:${key}`, line.value);
        }
        break;
    }
  }

  /** Group key of a tag by its key, memoized: tags repeat across thousands of files. */
  private group(key: string): string | null {
    let group = this.groups.get(key);
    if (group === undefined) this.groups.set(key, (group = groupKey(key)));
    return group;
  }

  /**
   * Keys of a record's visible tags in the order set: of the tags of one exclusive group, the one
   * whose `tag.add` line is later in the common order. Line steps are distinct, so the winner is the
   * same on every device.
   */
  private visible(entry: Entry): string[] {
    const keys = [...entry.tags.keys()];
    if (!this.exclusive.size) return keys;
    const latest = new Map<string, [key: string, step: number]>();
    for (const [key, step] of entry.tags.entries()) {
      const group = this.group(key);
      if (group === null || !this.exclusive.has(group)) continue;
      const best = latest.get(group);
      if (!best || step > best[1]) latest.set(group, [key, step]);
    }
    if (!latest.size) return keys;
    return keys.filter((key) => {
      const best = latest.get(this.group(key) ?? '');
      return !best || best[0] === key;
    });
  }

  /** Whether a record shows tag `key`; lists all its tags only for a tag of an exclusive group. */
  private shows(entry: Entry, key: string): boolean {
    if (!entry.tags.has(key)) return false;
    const group = this.group(key);
    return group === null || !this.exclusive.has(group) || this.visible(entry).includes(key);
  }

  /**
   * Move of a file or folder by device `device`: the record of the path and of all paths under `from/` go to
   * the new place, replacing the record there. Except one: if it was brought there by a move from the same
   * path recorded by another device, or by a chain of such moves from the same path through empty paths
   * (`chain`), it is the same move, so the records merge (`merge`) and the device is added to every step.
   * Only a move of a folder that has records under it scans all records.
   */
  private move(from: string, to: string, device: string): void {
    if (from === to) return;
    const own = this.entries.get(from);
    const moving: [string, Entry][] = this.under.has(from)
      ? [...this.entries].filter(([path]) => path === from || path.startsWith(`${from}/`))
      : own
        ? [[from, own]]
        : [];
    // The second device may have recorded only the first step after the first device had already moved the
    // file further. Check the whole previous chain before removing the source records and the destination
    // moves: a new record on an intermediate path, a move of it, or the file coming back breaks the chain and
    // leaves a plain replace.
    const continued = moving.map(([path]) => {
      const target = to + path.slice(from.length);
      if (!this.moved.has(target)) return null;
      const hops = this.movedTo(path, device);
      const end = hops?.at(-1);
      if (!end || end === target || !hops?.includes(target)) return null;
      const source = this.seen(path);
      const destination = this.seen(end);
      // One file's date may differ between devices; a different known size means a different record.
      if (source && destination && source.size !== destination.size) return null;
      const there = this.entries.get(end);
      const steps = there?.from ? this.chain(there.from, path, device) : null;
      return there && steps ? { there, steps, target } : null;
    });
    for (const [path] of moving) {
      this.entries.delete(path);
      this.count(path, -1);
    }
    const targets = moving.map(([path]) => to + path.slice(from.length));
    // An earlier move from the path that now receives a record is about another file.
    for (const [i, target] of targets.entries()) if (!continued[i]) this.moved.delete(target);
    moving.forEach(([path, entry], i) => {
      const onward = continued[i];
      if (onward) {
        this.merge(onward.there, entry);
        for (const hop of onward.steps) {
          record(hop, device);
          if (hop.to === onward.target) break;
        }
        return;
      }
      const target = targets[i] ?? to;
      const there = this.entries.get(target);
      const last = there?.from;
      // The same move: a single step directly, several steps as a chain (`chain`).
      const steps =
        !last || recorded(last, device) ? null : last.path === path ? [last] : this.chain(last, path, device);
      if (there && steps?.[0]) {
        this.merge(there, entry);
        for (const step of steps) record(step, device);
        this.moved.set(path, steps[0]);
        return;
      }
      if (!there) this.count(target, 1);
      // The record that was there is about another file and goes away with its references.
      else this.unlinkRefs(there);
      const hop: Hop = { path, to: target, devices: device };
      entry.from = hop;
      entry.home = target;
      this.entries.set(target, entry);
      this.moved.set(path, hop);
      this.came.set(target, hop);
    });
    this.moveRefs(from, to);
  }

  /**
   * A file or folder moved from `from` to `to`: every passport naming a reference at `from` or under `from/`
   * gets the new path. The passport object is replaced, never changed: journal lines share it.
   */
  private moveRefs(from: string, to: string): void {
    if (!this.refs.has(from) && !this.refUnder.has(from)) return;
    const prefix = `${from}/`;
    const moved = (path: string): boolean => path === from || path.startsWith(prefix);
    const touched = new Set<Entry>();
    for (const [path, entries] of this.refs) if (moved(path)) for (const entry of entries) touched.add(entry);
    for (const entry of touched) {
      const { gen } = entry;
      if (!gen?.refs) continue;
      this.unlinkRefs(entry);
      entry.gen = {
        ...gen,
        refs: gen.refs.map((ref) =>
          moved(ref.path) ? { ...ref, path: to + ref.path.slice(from.length) } : ref,
        ),
      };
      this.linkRefs(entry);
    }
  }

  /** The record's references join the reverse index. */
  private linkRefs(entry: Entry): void {
    for (const path of refPaths(entry.gen)) {
      const held = this.refs.get(path);
      if (held) {
        held.add(entry);
        continue;
      }
      this.refs.set(path, new Set([entry]));
      this.countRef(path, 1);
    }
  }

  /** The record's references leave the reverse index. */
  private unlinkRefs(entry: Entry): void {
    for (const path of refPaths(entry.gen)) {
      const held = this.refs.get(path);
      if (!held?.delete(entry) || held.size) continue;
      this.refs.delete(path);
      this.countRef(path, -1);
    }
  }

  /** A reference path appeared (+1) or went away (-1): for every folder above it. */
  private countRef(path: string, by: 1 | -1): void {
    for (let i = path.indexOf('/'); i >= 0; i = path.indexOf('/', i + 1)) {
      const folder = path.slice(0, i);
      const left = (this.refUnder.get(folder) ?? 0) + by;
      if (left) this.refUnder.set(folder, left);
      else this.refUnder.delete(folder);
    }
  }

  /** Merges record `source` into `target` of the same file (`merge`), keeping the reverse index right. */
  private merge(target: Entry, source: Entry): void {
    this.unlinkRefs(target);
    this.unlinkRefs(source);
    merge(target, source);
    this.linkRefs(target);
  }

  /**
   * Steps by which move `last` and the moves before it brought the record from path `source`, nearest to
   * `source` first: none recorded by device `device`, intermediate paths empty, and nothing moved away from
   * any path of the chain since; otherwise `null`. More than `MAX_HOPS` steps gives `null`.
   */
  private chain(last: Hop, source: string, device: string): Hop[] | null {
    const steps: Hop[] = [];
    for (let hop: Hop | undefined = last; hop && !recorded(hop, device); hop = this.came.get(hop.path)) {
      if (this.moved.get(hop.path) !== hop || steps.length === MAX_HOPS) return null;
      steps.push(hop);
      if (hop.path === source) return steps.reverse();
      if (this.entries.has(hop.path)) return null;
    }
    return null;
  }

  private entry(path: string): Entry {
    let entry = this.entries.get(path);
    if (!entry) {
      entry = {
        tags: new Map(),
        rating: 0,
        rated: -1,
        comments: new Map(),
        seen: new Map(),
        from: null,
        link: null,
        linked: -1,
        gen: null,
        genStep: -1,
        home: path,
      };
      this.entries.set(path, entry);
      this.came.delete(path);
      this.count(path, 1);
    }
    return entry;
  }

  /** A path record appeared (+1) or went away (-1): for every folder above it and for the file name. */
  private count(path: string, by: 1 | -1): void {
    for (let i = path.indexOf('/'); i >= 0; i = path.indexOf('/', i + 1)) {
      const folder = path.slice(0, i);
      const left = (this.under.get(folder) ?? 0) + by;
      if (left) this.under.set(folder, left);
      else this.under.delete(folder);
    }
    const name = path.slice(path.lastIndexOf('/') + 1);
    const held = this.byName.get(name);
    if (by > 0) {
      if (held === undefined) this.byName.set(name, path);
      else if (typeof held !== 'string') held.add(path);
      else if (held !== path) this.byName.set(name, new Set([held, path]));
    } else if (held === path) this.byName.delete(name);
    else if (typeof held !== 'string' && held?.delete(path) && held.size === 1) {
      const [last] = held;
      this.byName.set(name, last!);
    }
  }

  private comments(entry: Entry): FileComment[] {
    return [...entry.comments.values()]
      .filter(({ id }) => !this.removed.has(id))
      .map((comment) => (this.done.get(comment.id) ? { ...comment, done: true as const } : { ...comment }));
  }
}

/**
 * Merges record `source` into record `target` of the same file by the index's CRDT rules: tags and comments
 * are a union (tombstones cut removed comments, a tag keeps the later of the two steps); rating, link,
 * passport and each device's fingerprint come from the line later in the fold.
 */
function merge(target: Entry, source: Entry): void {
  for (const [key, step] of source.tags.entries())
    target.tags.set(key, Math.max(target.tags.get(key) ?? -1, step));
  for (const [id, comment] of source.comments) if (!target.comments.has(id)) target.comments.set(id, comment);
  if (source.rated > target.rated) {
    target.rating = source.rating;
    target.rated = source.rated;
  }
  if (source.linked > target.linked) {
    target.link = source.link;
    target.linked = source.linked;
  }
  if (source.genStep > target.genStep) {
    target.gen = source.gen;
    target.genStep = source.genStep;
  }
  const seen = [...target.seen, ...source.seen].sort(([, a], [, b]) => a.step - b.step);
  target.seen = new Map();
  for (const [device, fp] of seen) {
    target.seen.delete(device);
    target.seen.set(device, fp);
  }
}
