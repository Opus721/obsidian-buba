// Grid tiles in order: subfolders first, then the files of the source, which is a folder, "with subfolders",
// "All files" or another module's source. The source gives paths; records come from the file index by path.
import { compareFiles, withFoldersFirst, type SortableFile, type SortDir } from './sort-files.ts';

/** A file as the grid knows it: the path and what it is sorted by. */
export interface GridFile extends SortableFile {
  readonly path: string;
}

/** A grid tile: a subfolder with its path and name, or a file with its record. */
export type GridItem<F extends GridFile = GridFile> =
  | { readonly kind: 'folder'; readonly path: string; readonly name: string }
  | { readonly kind: 'file'; readonly path: string; readonly file: F };

const collator = new Intl.Collator(undefined, { numeric: true });

/**
 * Second sort level ("Then by"): a comparison from the registry and its own direction; applies within ties of
 * the first level. Absent when "None" is chosen or the key is not in the registry.
 */
export interface ThenSort<F extends GridFile = GridFile> {
  readonly compare: (a: F, b: F) => number;
  readonly dir: SortDir;
}

/**
 * The grid file order rule, shared by sorting (`gridItems`) and the "in place" check (`keepsPlace`):
 * `compare` from the sort registry in direction `dir`, ties by the second level `then` in its direction, then
 * by name ascending; without `compare`, by date added, like `sortFiles(…, 'created', dir)`.
 */
export function gridOrder<F extends GridFile>(
  compare: ((a: F, b: F) => number) | undefined,
  dir: SortDir,
  then?: ThenSort<F>,
): (a: F, b: F) => number {
  const sign = dir === 'desc' ? -1 : 1;
  const by = compare ?? compareFiles('created');
  if (!then) return (a, b) => sign * by(a, b) || collator.compare(a.name, b.name);
  const thenSign = then.dir === 'desc' ? -1 : 1;
  return (a, b) => sign * by(a, b) || thenSign * then.compare(a, b) || collator.compare(a.name, b.name);
}

/**
 * Tiles in order: subfolders by name first, then files by `compare` from the sort registry (ascending) in
 * direction `dir`, ties by the second level `then`, then by name ascending; without `compare`, by date added
 * (`sortFiles`). A path without a record (a vanished file) is not shown, a repeated path is one tile.
 */
export function gridItems<F extends GridFile>(
  paths: readonly string[],
  byPath: ReadonlyMap<string, F>,
  subfolders: readonly string[],
  compare: ((a: F, b: F) => number) | undefined,
  dir: SortDir,
  then?: ThenSort<F>,
): GridItem<F>[] {
  const seen = new Set<string>();
  const files: F[] = [];
  for (const path of paths) {
    const file = byPath.get(path);
    if (!file || seen.has(path)) continue;
    seen.add(path);
    files.push(file);
  }
  const ordered = files.sort(gridOrder(compare, dir, then));
  const folders = subfolders.map((path) => ({
    kind: 'folder' as const,
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
  }));
  return withFoldersFirst(
    folders,
    ordered.map((file) => ({ kind: 'file' as const, path: file.path, file })),
  );
}

/**
 * File `file` at position `at` sits strictly between its file neighbours by the `gridOrder` rule, so the
 * order is what a full re-sort would give. A tie with a neighbour is not "in place": the full sort decided
 * the order of equals. A folder neighbour or an edge does not matter: subfolders always come before files.
 */
export function keepsPlace<F extends GridFile>(
  items: readonly GridItem<F>[],
  at: number,
  file: F,
  compare: ((a: F, b: F) => number) | undefined,
  dir: SortDir,
  then?: ThenSort<F>,
): boolean {
  const rule = gridOrder(compare, dir, then);
  const prev = items[at - 1];
  const next = items[at + 1];
  return (
    (prev?.kind !== 'file' || rule(prev.file, file) < 0) &&
    (next?.kind !== 'file' || rule(file, next.file) < 0)
  );
}
