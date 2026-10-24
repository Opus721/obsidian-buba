// Contract of the storage module for tags, ratings, comments, file links and folder looks. The journal index,
// move pairing, storage, Obsidian adapters and the tag UI are built on it; no `obsidian` import. Paths are
// from the vault root.
import type { ColorValue } from '../color/value.ts';
import type { Passport } from './passport.ts';

/** Schema version, in every journal line (`v`); a line with an unknown version is never deleted. */
export const SCHEMA_VERSION = 1;

/**
 * Buba data folder at the vault root, the only place that names it: everyone who writes or reads it takes the
 * name from here (a test checks it). Buba writes only here.
 */
export const JOURNAL_DIR = '__buba-data';

/**
 * Legacy data folder: read and never changed; only an old version on a device that has not updated yet writes
 * there. Own journals move from it to `JOURNAL_DIR` as a copy (`src/platform/storage/data-dir.ts`).
 */
export const LEGACY_JOURNAL_DIR = 'Buba';

/** Both data folders, the new one first. */
export const DATA_DIRS: readonly string[] = [JOURNAL_DIR, LEGACY_JOURNAL_DIR];

/** The path is a data folder (new or legacy) or inside one: internal data, not a user file. */
export function inDataDir(path: string): boolean {
  return DATA_DIRS.some((dir) => path === dir || path.startsWith(`${dir}/`));
}

/** 0 means no rating. */
export type Rating = 0 | 1 | 2 | 3 | 4 | 5;

export interface FileComment {
  id: string;
  text: string;
  /** ISO 8601 UTC. */
  at: string;
  /** Id of the device where the comment was added. */
  device: string;
  /**
   * Marked done (`CommentDone`). An open comment has no field, so its record is the same as before done flags
   * existed, and storage fakes, agent commands and the `buba:info` output do not change.
   */
  done?: true;
}

export interface FileRecord {
  tags: string[];
  rating: Rating;
  comments: FileComment[];
}

export interface TagCount {
  tag: string;
  count: number;
}

/** File fingerprint: used to recognize a move made in the system file manager. */
export interface Fingerprint {
  /** Bytes. */
  size: number;
  /** Modification time, ms since 1970, like `stat.mtime` of an Obsidian file. */
  mtime: number;
  /** Name with extension, without the folder. */
  name: string;
}

/**
 * Tag group settings: `exclusive` means a file shows only the group tag set last; `color` is the group color,
 * `null` if never set.
 */
export interface GroupSettings {
  exclusive: boolean;
  color: ColorValue | null;
}

/**
 * Storage for the tag UI. Reads are synchronous from the in-memory index; tags and groups compare by
 * `tagKey`. A file's tags are the visible ones: one tag of an exclusive group.
 */
export interface BubaStorage {
  /** An empty record if there are none. */
  get(path: string): FileRecord;
  addTags(paths: string[], tags: string[]): Promise<void>;
  removeTags(paths: string[], tags: string[]): Promise<void>;
  setRating(paths: string[], rating: Rating): Promise<void>;
  addComment(path: string, text: string): Promise<FileComment>;
  removeComment(path: string, id: string): Promise<void>;
  allTags(): TagCount[];
  filesWithTag(tag: string): string[];
  /** Those of `paths` that have no tags. */
  untagged(paths: string[]): string[];
  /** The listener receives changed paths; returns an unsubscribe function. */
  onChange(listener: (paths: string[]) => void): () => void;
  /** Group as `tagGroup` returns it, any case; no settings means the flag is off and no color. */
  groupSettings(group: string): GroupSettings;
  /** Tag color; `null` if never set or removed. */
  tagColor(tag: string): ColorValue | null;
  /** Pinned colors of the color dialog by pinning time, pinned earlier first. */
  pinnedColors(): ColorValue[];
  /**
   * Files with more than one tag of the group, hidden ones included: their count is shown when
   * confirming the flag.
   */
  groupOverlaps(group: string): string[];
  /** Turns group exclusivity on or off; no file tag lines are written. */
  setGroupExclusive(group: string, exclusive: boolean): Promise<void>;
  /** `null` removes the color. */
  setGroupColor(group: string, color: ColorValue | null): Promise<void>;
  /** `null` removes the color. */
  setTagColor(tag: string, color: ColorValue | null): Promise<void>;
  setColorPinned(color: ColorValue, pinned: boolean): Promise<void>;
}

/**
 * A tag lives until deleted: a declared tag stays in the tag list without files and goes away only by
 * deletion or rename. A declaration is written by "New tag", and by the first set and first removal of a tag
 * that has no declaration line yet. Separate from `BubaStorage`: the file panel and agent commands do not
 * need to declare or delete, and the contract leaves their storage fakes alone.
 */
export interface TagDeclarations {
  /** Declared tags in the index spelling, with and without files. */
  declaredTags(): string[];
  /**
   * `true` declares the tag in the spelling `tag` ("New tag"): a tag without files and without a
   * declaration starts without old settings, as on its first set; `false` removes the declaration. The same
   * value is not written again.
   */
  setTagDeclared(tag: string, declared: boolean): Promise<void>;
  /**
   * "Delete tag…" as one write: removal from all records with the tag, hidden ones included (removing
   * a visible tag of an exclusive group takes its hidden neighbours too), plus removal of the
   * declaration and color.
   */
  deleteTag(tag: string): Promise<void>;
}

/**
 * Counts for the "All tags" tree straight from index records: tags in the index spelling, groups by
 * group key (`tagKey`).
 */
export interface TagTally {
  /** Visible tags of existing files with their file counts; declared tags without files count 0. */
  tags: TagCount[];
  /**
   * Group key -> files that exist with any visible tag of the group, once per file; a group made only
   * of 0-count tags has 0.
   */
  groups: Map<string, number>;
  /** Group key -> spellings of its tags from `tags`: the list picks the group name from them. */
  members: Map<string, string[]>;
}

/**
 * Tag tree and group grid queries as a pass over index record keys, without building a file record per path:
 * at 50,000 files building a record for each path is more than half of the pass. Separate from `BubaStorage`:
 * the file panel and agent commands do not need them, and the contract leaves their storage fakes alone.
 */
export interface TagQueries {
  /**
   * Tree counts for files where `exists` is true; storage keeps records of missing files, but
   * they are not counted.
   */
  tagTally(exists: (path: string) => boolean): TagTally;
  /**
   * Files with any visible tag of the group, missing files' records included; case-insensitive; an
   * empty name gives nothing.
   */
  groupFiles(group: string): string[];
}

/**
 * Storage for the tag list, menus and dialogs: reading and writing tags and their declarations. The plugin's
 * storage always has the tree queries (`StorageEngine`); a storage fake in a test may lack them, and then the
 * list counts by a pass over file records.
 */
export type TagStorage = BubaStorage & TagDeclarations & Partial<TagQueries>;

/**
 * A file's link: one, only http or https (`isLinkUrl`), travels with the file like tags. Separate from
 * `BubaStorage`: `FileRecord` stays as it was, and the contract leaves the panel and agent command
 * storage fakes alone.
 */
export interface FileLinks {
  /** `null` if there is no link. */
  link(path: string): string | null;
  /** `null` removes it; an invalid one is refused before writing; the same value is not written again. */
  setLink(path: string, url: string | null): Promise<void>;
}

/** Folder look in the Buba tree: icon color and Lucide icon (`isIconId`); `null` if never set or removed. */
export interface FolderLook {
  color: ColorValue | null;
  icon: string | null;
}

/**
 * Folder looks of the Buba tree, keyed by folder path like `TFolder.path`; they follow a renamed
 * folder. Own event channel: writing a look does not wake tag subscribers, and editing tags does not
 * wake look subscribers.
 */
export interface FolderLooks {
  /** Both fields `null` if there is no look. */
  folderLook(path: string): FolderLook;
  /**
   * `null` removes it; an invalid path or color is refused before writing; the same value
   * is not written again.
   */
  setFolderColor(path: string, color: ColorValue | null): Promise<void>;
  /**
   * `null` means the default icon; an invalid path or icon is refused before writing; the same value
   * is not written again.
   */
  setFolderIcon(path: string, icon: string | null): Promise<void>;
  /** The listener receives paths of folders whose look changed; returns an unsubscribe function. */
  onFolderLook(listener: (paths: string[]) => void): () => void;
}

/** Vault events, for the Obsidian adapter. */
export interface StorageEvents {
  load(): Promise<void>;
  reload(): Promise<void>;
  fileRenamed(from: string, to: string): Promise<void>;
  fileAppeared(path: string, fp: Fingerprint): Promise<void>;
  fileDisappeared(path: string, fp: Fingerprint): Promise<void>;
  fileChanged(path: string, fp: Fingerprint): Promise<void>;
  reconcile(files: { path: string; fp: Fingerprint }[]): Promise<void>;
}

/**
 * A comment's "done" flag: a `comment.done` line keyed by comment id; the last line in the common line order
 * wins. Separate from `BubaStorage`, like `FileLinks`: the contract leaves the panel, tag and agent command
 * storage fakes alone.
 */
export interface CommentDone {
  /** No line is written if the file has no comment `id` or the flag is already the same. */
  setCommentDone(path: string, id: string, done: boolean): Promise<void>;
}

/**
 * A file's generation passport: one per path, travels with the file like the link; its references
 * are vault paths that follow their files. Separate from `BubaStorage`, like `FileLinks`: the contract leaves
 * the panel, tag and agent command storage fakes alone.
 */
export interface FilePassports {
  /** `null` if the file has no passport. */
  passport(path: string): Passport | null;
  /**
   * `null` removes it; an invalid one is refused before writing (`RangeError`, see `readPassportInput`); the
   * same value is not written again. Storage adds its own fingerprint of the file and of every reference.
   */
  setPassport(path: string, passport: unknown): Promise<void>;
  /** Results whose passport names `path` as a reference, existing files only, newest `createdAt` first. */
  usedIn(path: string): string[];
}

export type StorageEngine = TagStorage &
  TagQueries &
  FileLinks &
  FolderLooks &
  CommentDone &
  FilePassports &
  StorageEvents;

/**
 * Journal I/O provided by the platform. The contract allows neither rewriting nor deleting a journal, so
 * lines of an unknown schema are never lost on any device.
 */
export interface JournalIO {
  /** Appends to the end of the journal; creates it if missing. */
  append(file: string, text: string): Promise<void>;
  readAll(): Promise<{ file: string; text: string }[]>;
}

/** A journal action about a file. The tag is after `normalizeTag`, in its original spelling. */
export type JournalAction =
  | { op: 'tag.add'; path: string; tag: string }
  | { op: 'tag.remove'; path: string; tag: string }
  | { op: 'rating.set'; path: string; rating: Rating }
  | { op: 'comment.add'; path: string; id: string; text: string }
  | { op: 'comment.remove'; path: string; id: string }
  /**
   * Comment done flag: lives by `id`, like the `comment.remove` tombstone, so it survives a file move; `path`
   * is the file where it was set. Older versions that do not know the line skip it and never erase it.
   */
  | { op: 'comment.done'; path: string; id: string; done: boolean }
  | { op: 'file.move'; path: string; to: string }
  | { op: 'file.seen'; path: string; size: number; mtime: number }
  /** A file's link: `isLinkUrl`, or `null` when removed. */
  | { op: 'link.set'; path: string; url: string | null }
  /** A file's generation passport (`readPassportLine`), or `null` when removed. */
  | { op: 'gen.set'; path: string; gen: Passport | null };

/**
 * A group, tag, color dialog or folder look setting: the last line in the common line order wins. The group
 * and tag key is `tagKey`, the pinned color key is the color itself, the folder look key is its path
 * (`isFolderPath`). A tag declaration (`declared`) carries its spelling, because the key is lower case and a
 * tag without files would otherwise lose it; `false` means the tag was deleted.
 */
export type MetaAction =
  | { op: 'meta.set'; kind: 'group'; key: string; field: 'exclusive'; value: boolean }
  | { op: 'meta.set'; kind: 'group' | 'tag'; key: string; field: 'color'; value: ColorValue | null }
  | { op: 'meta.set'; kind: 'tag'; key: string; field: 'declared'; value: string | false }
  | { op: 'meta.set'; kind: 'palette'; key: ColorValue; field: 'pinned'; value: boolean }
  | { op: 'meta.set'; kind: 'folder'; key: string; field: 'color'; value: ColorValue | null }
  | { op: 'meta.set'; kind: 'folder'; key: string; field: 'icon'; value: string | null };

/** Line head: `v` schema version, `at` ISO 8601 UTC, `dev` device id. */
interface LineHead {
  v: number;
  at: string;
  dev: string;
}

/** A journal line about a file. */
export type JournalLine = JournalAction & LineHead;

/** A `meta.set` setting line. */
export type MetaLine = MetaAction & LineHead;

/** Any known journal line: about a file, or a setting. */
export type KnownLine = JournalLine | MetaLine;

/** Device id: exactly 8 characters `[a-z0-9]`. */
export function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]{8}$/.test(value);
}

/**
 * Folder path as a folder look key: like `TFolder.path` after Obsidian's `normalizePath`, non-empty, no `/`
 * at either end and no empty segments. The vault root (`/`) has no look.
 */
export function isFolderPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== '' &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    !value.includes('//')
  );
}

/**
 * Device journal for a month: `<data folder>/<device>-<YYYY-MM>.jsonl`, month in UTC. A malformed device id
 * throws: it goes into the file path, and `../` would put the write outside the data folder.
 */
export function journalPath(device: string, date: Date | number): string {
  if (!isDeviceId(device))
    throw new RangeError(`Device id must be 8 characters [a-z0-9], not ${JSON.stringify(device)}`);
  return `${JOURNAL_DIR}/${device}-${new Date(date).toISOString().slice(0, 7)}.jsonl`;
}

/** Edges trimmed, inner whitespace collapsed to one space; empty gives `null`. Case is kept. */
export function normalizeTag(tag: string): string | null {
  return tag.trim().replace(/\s+/g, ' ') || null;
}

/**
 * Tag comparison key, case-insensitive: the spelling of the first record is shown, the journal keeps the
 * original. `toLowerCase` without a locale, so the key is the same on all devices. Empty gives `null`.
 */
export function tagKey(tag: string): string | null {
  return normalizeTag(tag)?.toLowerCase() ?? null;
}
