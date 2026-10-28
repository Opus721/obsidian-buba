// Created and modified times of folders for the tree's date orders. Obsidian's `TFolder` has no `stat`, so the
// times come from the adapter (`DataAdapter.stat` answers for folders too), on demand: a folder the tree asks
// about and does not know yet is read in the next round, and listeners hear once a round is in. Creating,
// deleting or renaming something in a folder changes its modified time on disk, as the system file manager
// shows it, so these vault events forget the folder's time and the next ask reads it again; a renamed folder
// is read under its new path. Until the new time is in, the old one is given: without it the folder would
// sort after dated ones for a moment and jump back once read (word of the owner 27.10: a folder hopped down
// and up on paste, undo and redo). A folder whose read fails stays without a time and sorts after dated ones.
import type { Plugin } from 'obsidian';
import { folderOf } from './file-index.ts';

/** A folder's created and modified time on disk, ms. */
export interface FolderTime {
  readonly ctime: number;
  readonly mtime: number;
}

type Stat = (path: string) => Promise<FolderTime | null>;

/** Folders read at once: 2,000 folders of a large vault in about 30 rounds. */
const ROUND = 64;

export class FolderTimes {
  readonly #stat: Stat;
  /** `null`: read and failed, not asked again until forgotten. */
  readonly #times = new Map<string, FolderTime | null>();
  /** Known folders forgotten since: their old time is given until the new one is read. */
  readonly #old = new Set<string>();
  readonly #queue = new Set<string>();
  /** Folders of the round being read, and those of them forgotten meanwhile: their answer may be old. */
  #inRound = new Set<string>();
  readonly #stale = new Set<string>();
  readonly #listeners = new Set<() => void>();
  /** Calls waiting in `known` for the reads under way. */
  readonly #waiters: (() => void)[] = [];
  #reading = false;

  constructor(stat: Stat) {
    this.#stat = stat;
  }

  /**
   * The folder's time, or `undefined` while unknown: then it is read and listeners hear when it is in. A
   * forgotten folder gives its old time meanwhile.
   */
  get(path: string): FolderTime | undefined {
    const known = this.#times.get(path);
    if (known !== undefined && !this.#old.has(path)) return known ?? undefined;
    this.#queue.add(path);
    if (!this.#reading) void this.#read();
    return known ?? undefined;
  }

  /**
   * `null` when the times of all `paths` are known and fresh; otherwise they are read, and the promise
   * resolves once they are in, after the listeners heard. The tree waits on it before expanding a folder in a
   * date order, so the children appear in their final order at once instead of by name first and reordered
   * a moment later, which cut the expand motion short.
   */
  known(paths: readonly string[]): Promise<void> | null {
    const missing = paths.filter((path) => this.#times.get(path) === undefined || this.#old.has(path));
    if (!missing.length) return null;
    for (const path of missing) this.get(path);
    return new Promise((done) => this.#waiters.push(done));
  }

  /** The folder changed on disk: its time is read again on the next ask. */
  forget(path: string): void {
    if (this.#times.has(path)) this.#old.add(path);
    if (this.#inRound.has(path)) this.#stale.add(path);
  }

  /** The listener is called after each round of reads; returns the unsubscribe call. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  async #read(): Promise<void> {
    this.#reading = true;
    // Asks of one render come in one go: the round starts after them.
    await Promise.resolve();
    try {
      while (this.#queue.size) {
        const paths = [...this.#queue].slice(0, ROUND);
        for (const path of paths) this.#queue.delete(path);
        this.#inRound = new Set(paths);
        const stats = await Promise.all(paths.map((path) => this.#stat(path).catch(() => null)));
        paths.forEach((path, at) => {
          const stat = stats[at];
          if (this.#stale.has(path)) this.#queue.add(path);
          else {
            this.#times.set(path, stat ? { ctime: stat.ctime, mtime: stat.mtime } : null);
            this.#old.delete(path);
          }
        });
        this.#stale.clear();
        this.#inRound = new Set();
      }
    } finally {
      this.#reading = false;
    }
    for (const listener of [...this.#listeners]) listener();
    for (const done of this.#waiters.splice(0)) done();
  }
}

const stores = new WeakMap<Plugin, FolderTimes>();

/** The plugin's folder times, shared by all trees; vault events keep them fresh once the layout is ready. */
export function folderTimes(plugin: Plugin): FolderTimes {
  const known = stores.get(plugin);
  if (known) return known;
  const { vault, workspace } = plugin.app;
  const times = new FolderTimes((path) => vault.adapter.stat(path));
  stores.set(plugin, times);
  workspace.onLayoutReady(() => {
    const changed = (path: string): void => {
      times.forget(folderOf(path));
      times.forget(path);
    };
    plugin.registerEvent(vault.on('create', (file) => changed(file.path)));
    plugin.registerEvent(vault.on('delete', (file) => changed(file.path)));
    plugin.registerEvent(
      vault.on('rename', (file, oldPath) => {
        changed(oldPath);
        changed(file.path);
      }),
    );
  });
  return times;
}
