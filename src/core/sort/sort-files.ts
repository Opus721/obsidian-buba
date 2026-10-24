// Grid file sorts: by date added (for regular files the creation date, `ctime`), by name, modification date
// and size; subfolders come before files. Names sort naturally, as in Windows Explorer: numbers inside names
// compare as numbers, `img2` before `img10` (`Intl.Collator` with `numeric: true`).

export type SortKey = 'created' | 'name' | 'modified' | 'size';
export type SortDir = 'asc' | 'desc';

/** What sorting needs from a file: name, creation and modification dates (ms), size (bytes). */
export interface SortableFile {
  readonly name: string;
  readonly ctime: number;
  readonly mtime: number;
  readonly size: number;
}

const collator = new Intl.Collator(undefined, { numeric: true });
const byName = (a: { readonly name: string }, b: { readonly name: string }): number =>
  collator.compare(a.name, b.name);

const valueOf: Record<Exclude<SortKey, 'name'>, (file: SortableFile) => number> = {
  created: (file) => file.ctime,
  modified: (file) => file.mtime,
  size: (file) => file.size,
};

/**
 * Compares files by the key only, ascending; equal keys give 0. Direction and the order of equals (by name,
 * ascending) are added by the caller, as `sortFiles` does. The grid sort registry uses the same comparison
 * for the built-in keys (`src/assets/grid/sort-keys.ts`).
 */
export function compareFiles(key: SortKey): (a: SortableFile, b: SortableFile) => number {
  if (key === 'name') return byName;
  const value = valueOf[key];
  return (a, b) => {
    const x = value(a);
    const y = value(b);
    return x < y ? -1 : x > y ? 1 : 0;
  };
}

/**
 * Files by key and direction as a new array; the input is not changed. The sort is stable; equal keys go by
 * name ascending in both directions.
 */
export function sortFiles<T extends SortableFile>(items: readonly T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === 'desc' ? -1 : 1;
  const compare = compareFiles(key);
  return [...items].sort((a, b) => sign * compare(a, b) || byName(a, b));
}

/** Subfolders by name before files, as in a file explorer; files keep the given order. */
export function withFoldersFirst<F extends { readonly name: string }, T>(
  folders: readonly F[],
  files: readonly T[],
): (F | T)[] {
  return [...[...folders].sort(byName), ...files];
}
