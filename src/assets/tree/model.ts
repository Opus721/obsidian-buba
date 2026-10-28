// Row model of the Buba tree, without the obsidian import: from subfolders, counts and expanded paths it
// builds a flat list of visible rows in display order. The tree view renders markup from it.
import { movedPath } from '../../core/layout/view-state.ts';
import { ROOT, nameOf } from '../../platform/files/file-index.ts';
import type { FolderTime } from '../../platform/files/folder-times.ts';

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
 * Tree folder order, like the "Sort order" of Obsidian's file explorer (`sortOrder`, app.js 1.14.4), with its
 * names: by name A to Z and Z to A, by modified time and by created time, new to old and (`…Reverse`) old to
 * new. Z to A is A to Z reversed (Obsidian negates the A to Z comparison), so numbers in names still compare
 * by value and `img10` comes before `img2`. Obsidian's explorer keeps folders by name in every order; the tree
 * has only folders, so the dates apply to them, as the system file manager sorts folders by "Date created".
 */
export const FOLDER_ORDERS = [
  'alphabetical',
  'alphabeticalReverse',
  'byModifiedTime',
  'byModifiedTimeReverse',
  'byCreatedTime',
  'byCreatedTimeReverse',
] as const;
export type FolderOrder = (typeof FOLDER_ORDERS)[number];

/** Folder times for the date orders; `undefined` while a folder's time is not known. */
export type FolderTimeOf = (path: string) => FolderTime | undefined;

/** Whether `order` sorts by a date and needs folder times. */
export function isDateOrder(order: FolderOrder): boolean {
  return order !== 'alphabetical' && order !== 'alphabeticalReverse';
}

/**
 * Sibling folders, given by name, in `order`. Equal dates keep the name order; folders whose time is not
 * known yet go after the dated ones, by name.
 */
export function ordered(byName: readonly string[], order: FolderOrder, time?: FolderTimeOf): string[] {
  if (order === 'alphabetical') return [...byName];
  if (order === 'alphabeticalReverse') return [...byName].reverse();
  const key = order.startsWith('byModified') ? 'mtime' : 'ctime';
  const sign = order.endsWith('Reverse') ? 1 : -1;
  const dated = byName.map((path) => ({ path, at: time?.(path)?.[key] }));
  return dated
    .sort((a, b) => {
      if (a.at === undefined || b.at === undefined)
        return (a.at === undefined ? 1 : 0) - (b.at === undefined ? 1 : 0);
      return sign * (a.at - b.at);
    })
    .map(({ path }) => path);
}

/**
 * Visible rows: root folders and, under each expanded one, its subfolders, in `order` at every level; the date
 * orders read folder times from `time`.
 */
export function treeRows(
  folders: TreeFolders,
  expanded: ReadonlySet<string>,
  order: FolderOrder = 'alphabetical',
  time?: FolderTimeOf,
): FolderRow[] {
  const rows: FolderRow[] = [];
  const walk = (folder: string, depth: number): void => {
    for (const path of ordered(folders.subfolders(folder), order, time)) {
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
