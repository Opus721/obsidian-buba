// Grid navigation without Obsidian: what counts as a tab history step, and the parts of a folder path.
// Obsidian keeps the history itself: tab arrows work as for notes (`View.navigation`,
// `ViewStateResult.history`).
import { t } from '../../core/i18n/dict/grid.ts';
import type { GridSourceState, GridViewState } from '../../core/layout/view-state.ts';

/** What the grid shows: a folder path from the vault root, `'/'` for the root, `null` for "All files". */
export type Folder = string | null;

/** A part of the path above the grid: its label and the folder a click on it opens. */
export interface Crumb {
  readonly label: string;
  readonly folder: Folder;
}

/**
 * A tab history step is a change of what is shown: folder, "All files" or a module's source. "With
 * subfolders" and the view (sort, direction, size, masonry, fit, names) are not steps. Going back takes the
 * view from the place: its own view or the shared one.
 */
export function isNavigationStep(prev: GridViewState, next: GridViewState): boolean {
  return prev.folder !== next.folder || !sameSource(prev.source, next.source);
}

/** A source is plain module data: the same source has the same fields with the same values, in any order. */
function sameSource(a: GridSourceState | undefined, b: GridSourceState | undefined): boolean {
  if (!a || !b) return a === b;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && JSON.stringify(a[key]) === JSON.stringify(b[key]))
  );
}

/** Folder path parts from the vault root; the root shows the vault name, "All files" is one part. */
export function crumbs(folder: Folder, vaultName: string): Crumb[] {
  if (folder === null) return [{ label: t('allFiles'), folder: null }];
  const parts: Crumb[] = [{ label: vaultName, folder: '/' }];
  let path = '';
  for (const name of folder.split('/')) {
    if (name === '') continue;
    path = path === '' ? name : `${path}/${name}`;
    parts.push({ label: name, folder: path });
  }
  return parts;
}

/**
 * The folder a breadcrumb of an Obsidian file view opens: crumb `index` of `count` above the file at `path`.
 * Obsidian draws one crumb per parent folder, from the top; an extra crumb in front is taken as the vault
 * root. A count that matches neither gives `undefined`, and the click is left to Obsidian.
 */
export function crumbFolder(path: string, index: number, count: number): string | undefined {
  const parts = path
    .split('/')
    .slice(0, -1)
    .filter((part) => part !== '');
  const shift = count - parts.length;
  if ((shift !== 0 && shift !== 1) || index < 0 || index >= count) return undefined;
  if (index < shift) return '/';
  return parts.slice(0, index - shift + 1).join('/');
}
