// Row model of the Buba tree, without the obsidian import: from subfolders, counts and expanded paths it
// builds a flat list of visible rows in display order. The tree view renders markup from it.
import { movedPath } from '../../core/layout/view-state.ts';
import { ROOT, nameOf } from '../../platform/files/file-index.ts';

/** Where the model takes folders from; the file index (`FileIndex`) fits as is. */
export interface TreeFolders {
  /** Direct subfolders, by name. */
  subfolders(folder: string): readonly string[];
  /** The folder's own files, not nested ones. */
  count(folder: string): number;
}

/** A folder row in the tree. */
export interface FolderRow {
  path: string;
  name: string;
  /** 0 is a folder in the vault root. */
  depth: number;
  hasChildren: boolean;
  /** Only for a folder with subfolders. */
  expanded: boolean;
  count: number;
}

/**
 * Tree folder order, like the "Sort order" of Obsidian's file explorer (`sortOrder`, app.js 1.14.4): by name
 * A to Z and Z to A. Z to A is A to Z reversed (Obsidian negates the A to Z comparison), so numbers in names
 * still compare by value and `img10` comes before `img2`.
 */
export const FOLDER_ORDERS = ['alphabetical', 'alphabeticalReverse'] as const;
export type FolderOrder = (typeof FOLDER_ORDERS)[number];

/**
 * Visible rows: root folders and, under each expanded one, its subfolders, by name in `order` at every level.
 */
export function treeRows(
  folders: TreeFolders,
  expanded: ReadonlySet<string>,
  order: FolderOrder = 'alphabetical',
): FolderRow[] {
  const rows: FolderRow[] = [];
  const walk = (folder: string, depth: number): void => {
    const byName = folders.subfolders(folder);
    for (const path of order === 'alphabeticalReverse' ? [...byName].reverse() : byName) {
      const hasChildren = folders.subfolders(path).length > 0;
      const open = hasChildren && expanded.has(path);
      rows.push({ path, name: nameOf(path), depth, hasChildren, expanded: open, count: folders.count(path) });
      if (open) walk(path, depth + 1);
    }
  };
  walk(ROOT, 0);
  return rows;
}

/** Expands all parents of folder `path` so its row is visible; the folder itself stays as it was. */
export function expandParents(expanded: ReadonlySet<string>, path: string): Set<string> {
  const out = new Set(expanded);
  for (let at = path.indexOf('/'); at > 0; at = path.indexOf('/', at + 1)) out.add(path.slice(0, at));
  return out;
}

/** Expands every folder with subfolders, at all levels. */
export function expandAll(folders: TreeFolders): Set<string> {
  const out = new Set<string>();
  const walk = (folder: string): void => {
    for (const path of folders.subfolders(folder)) {
      if (folders.subfolders(path).length === 0) continue;
      out.add(path);
      walk(path);
    }
  };
  walk(ROOT);
  return out;
}

/** Nothing expanded. */
export function collapseAll(): Set<string> {
  return new Set();
}

/** `oldPath` became `newPath` (renamed or moved): it and the expanded folders inside follow. */
export function renameExpanded(expanded: ReadonlySet<string>, oldPath: string, newPath: string): Set<string> {
  const out = new Set<string>();
  for (const path of expanded) out.add(movedPath(path, oldPath, newPath));
  return out;
}

/** Order from the leaf state `{ sortOrder }`; missing, broken or unknown gives A to Z. */
export function orderFromState(state: unknown): FolderOrder {
  const order =
    typeof state === 'object' && state !== null ? (state as { sortOrder?: unknown }).sortOrder : null;
  return FOLDER_ORDERS.find((each) => each === order) ?? 'alphabetical';
}

/** Expanded folders from the leaf state `{ expanded: string[] }`; broken or foreign state expands nothing. */
export function expandedFromState(state: unknown): Set<string> {
  const list =
    typeof state === 'object' && state !== null ? (state as { expanded?: unknown }).expanded : null;
  if (!Array.isArray(list)) return new Set();
  return new Set(list.filter((path): path is string => typeof path === 'string' && path !== ''));
}
