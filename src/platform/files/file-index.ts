// Index of vault files by folder, without importing obsidian; vault-index.ts fills it. A file's key is its
// path from the vault root; the root path is '/'.
import { DATA_DIRS } from '../../core/storage/types.ts';

/** A vault file as the tree and grid show it. */
export interface FileRecord {
  readonly path: string;
  readonly name: string;
  /** Lowercase, without the dot; empty string if there is no extension. */
  readonly ext: string;
  /** The file's folder path; '/' for a file at the root. */
  readonly folder: string;
  readonly size: number;
  readonly ctime: number;
  readonly mtime: number;
}

export const ROOT = '/';

/**
 * Hidden with all their contents: Buba data folders (`__buba-data` and the old `Buba`) and top-level dot
 * folders, which hold Obsidian's config folder whatever its name (`Vault#configDir`).
 */
export function isHidden(path: string): boolean {
  const slash = path.indexOf('/');
  const top = slash === -1 ? path : path.slice(0, slash);
  return top.startsWith('.') || DATA_DIRS.includes(top);
}

export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? ROOT : path.slice(0, slash);
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Record from a path and the file's `stat`; the extension follows the same rule as `TFile.extension`. */
export function recordOf(path: string, stat: { size: number; ctime: number; mtime: number }): FileRecord {
  const name = nameOf(path);
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
  return { path, name, ext, folder: folderOf(path), size: stat.size, ctime: stat.ctime, mtime: stat.mtime };
}

interface FolderNode {
  readonly files: Map<string, FileRecord>;
  readonly subfolders: Set<string>;
}

const collator = new Intl.Collator(undefined, { numeric: true });
const byName = (a: string, b: string) => collator.compare(nameOf(a), nameOf(b));

/**
 * Path set version of an index (`FileIndex.pathsVersion`); `null` for an index without a counter (test
 * fakes), in which case every change counts as a new path set.
 */
export function pathsVersionOf(index: object): number | null {
  const own = (index as { pathsVersion?: unknown }).pathsVersion;
  return typeof own === 'function' ? (own.call(index) as number) : null;
}

export class FileIndex {
  readonly #files = new Map<string, FileRecord>();
  readonly #folders = new Map<string, FolderNode>([[ROOT, { files: new Map(), subfolders: new Set() }]]);
  readonly #listeners = new Set<() => void>();
  #depth = 0;
  #dirty = false;
  #paths = 0;
  #filled = false;
  /** Depth of listener calls in `#flush`, see `notifying()`. */
  #notifying = 0;

  /**
   * Puts a record, replacing one with the same path and creating missing folders. The same record again is
   * not a change: after a folder rename Obsidian also sends `rename` for every file inside.
   */
  add(record: FileRecord): void {
    if (isHidden(record.path)) return;
    const known = this.#files.get(record.path);
    if (known && known.size === record.size && known.mtime === record.mtime && known.ctime === record.ctime)
      return;
    if (!known) this.#paths += 1;
    this.#files.set(record.path, record);
    this.#ensure(record.folder).files.set(record.path, record);
    this.#changed();
  }

  /** Same as add: the file's size or dates changed, the path did not. */
  update(record: FileRecord): void {
    this.add(record);
  }

  remove(path: string): void {
    const record = this.#files.get(path);
    if (!record) return;
    this.#files.delete(path);
    this.#folders.get(record.folder)?.files.delete(path);
    this.#paths += 1;
    this.#changed();
  }

  rename(oldPath: string, record: FileRecord): void {
    this.batch(() => {
      this.remove(oldPath);
      this.add(record);
    });
  }

  addFolder(path: string): void {
    if (isHidden(path) || this.#folders.has(path)) return;
    this.#ensure(path);
    this.#paths += 1;
    this.#changed();
  }

  /** Removes a folder with all its subfolders and files. */
  removeFolder(path: string): void {
    if (path === ROOT || !this.#folders.has(path)) return;
    for (const folder of this.#subtree(path)) {
      for (const file of this.#folders.get(folder)!.files.keys()) this.#files.delete(file);
      this.#folders.delete(folder);
    }
    this.#folders.get(folderOf(path))?.subfolders.delete(path);
    this.#paths += 1;
    this.#changed();
  }

  /** Moves a folder with all its contents: nested folders and files get a new path prefix. */
  renameFolder(oldPath: string, newPath: string): void {
    if (oldPath === newPath || oldPath === ROOT) return;
    const moved = (path: string) => newPath + path.slice(oldPath.length);
    const folders = this.#folders.has(oldPath) ? this.#subtree(oldPath) : [];
    const files = this.#filesOf(folders);
    this.batch(() => {
      this.removeFolder(oldPath);
      this.addFolder(newPath);
      for (const folder of folders) this.addFolder(moved(folder));
      for (const file of files) this.add({ ...file, path: moved(file.path), folder: moved(file.folder) });
    });
  }

  allFiles(): FileRecord[] {
    return [...this.#files.values()];
  }

  /** Files of a folder; with deep, including all nested folders. */
  filesIn(folder: string, deep: boolean): FileRecord[] {
    if (!this.#folders.has(folder)) return [];
    return this.#filesOf(deep ? this.#subtree(folder) : [folder]);
  }

  /** Direct subfolders, by name. */
  subfolders(folder: string): string[] {
    return [...(this.#folders.get(folder)?.subfolders ?? [])].sort(byName);
  }

  /** The folder's own files, without nested ones: as many tiles as a click on it shows. */
  count(folder: string): number {
    return this.#folders.get(folder)?.files.size ?? 0;
  }

  total(): number {
    return this.#files.size;
  }

  /**
   * Path set version: grows when a file or folder path appears or goes away (add, delete, move) and stays the
   * same on an edit of a file with the same path. Every note autosave is a file edit, while tags and tag
   * counts do not depend on content, so their subscribers skip such edits by this version, just as Obsidian's
   * tags pane waits for the metadata cache to finish rather than reacting to every edit.
   */
  pathsVersion(): number {
    return this.#paths;
  }

  /**
   * Whether the index is filled with vault files (`markFilled`, after `onLayoutReady`). Before that an empty
   * answer means "not known yet", not "empty": the grid shows its empty-folder hint only after filling.
   */
  filled(): boolean {
    return this.#filled;
  }

  /**
   * Marks filling as done, once: a new path set and a change for subscribers, also in an empty vault where
   * nothing was added. The version grows so that filling is not mistaken for an edit of a file with the same
   * path (`pathsVersion`).
   */
  markFilled(): void {
    if (this.#filled) return;
    this.#filled = true;
    this.#paths += 1;
    this.#changed();
  }

  /**
   * Whether index listeners are being called right now, including at the end of `batch`. A signal arriving
   * inside is an echo of this same index change (the grid's "folder" and "All files" sources listen to the
   * same index); one arriving outside is the source's own (a tag was set). This lets the grid view tell a
   * content change from a module source signal without knowing which source it is.
   */
  notifying(): boolean {
    return this.#notifying > 0;
  }

  /** The listener is called after every change; returns the unsubscribe call. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Changes inside run produce one listener call at the end. */
  batch(run: () => void): void {
    this.#depth += 1;
    try {
      run();
    } finally {
      this.#depth -= 1;
      this.#flush();
    }
  }

  #changed(): void {
    this.#dirty = true;
    this.#flush();
  }

  #flush(): void {
    if (this.#depth > 0 || !this.#dirty) return;
    this.#dirty = false;
    this.#notifying += 1;
    try {
      for (const listener of [...this.#listeners]) listener();
    } finally {
      this.#notifying -= 1;
    }
  }

  #ensure(path: string): FolderNode {
    let node = this.#folders.get(path);
    if (!node) {
      node = { files: new Map(), subfolders: new Set() };
      this.#folders.set(path, node);
      this.#ensure(folderOf(path)).subfolders.add(path);
    }
    return node;
  }

  /** The folder and everything nested in it. */
  #subtree(path: string): string[] {
    const out = [path];
    for (let at = 0; at < out.length; at += 1) {
      for (const sub of this.#folders.get(out[at]!)!.subfolders) out.push(sub);
    }
    return out;
  }

  #filesOf(folders: readonly string[]): FileRecord[] {
    const out: FileRecord[] = [];
    for (const folder of folders)
      for (const file of this.#folders.get(folder)!.files.values()) out.push(file);
    return out;
  }
}
