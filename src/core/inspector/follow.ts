// What the file panel shows, without the `obsidian` import. The panel follows the main view, like Obsidian's
// "Backlinks" follows the active file: the main view is the active leaf if it is a navigation leaf, otherwise
// the last active leaf of the main area (`Workspace.getActiveFileView`, app.js of Obsidian 1.13.7). A Buba
// grid gives its selection, a file view its file; anything else (an empty tab, the graph) keeps what is
// shown. The panel remembers which main view and which content of it the shown files came from: the same view
// with the same content changes nothing (focus went to the panel or a sidebar and came back, the grid changed
// sort or size). A view is any value; references are compared.
import { movedPath } from '../layout/view-state.ts';

/** Main view: a grid (its content, selected files, "is the path in its content"), a file view, or other. */
export type MainView<V> =
  | {
      readonly kind: 'grid';
      readonly view: V;
      /**
       * What the grid shows, as a string (`gridContentKey`, src/core/layout/view-state.ts): folder, "with
       * subfolders", source. Sort, size and layout are not content: they do not change what is shown.
       */
      readonly state: string;
      readonly selected: readonly string[];
      /**
       * Raw grid selection including folders: it shows that something new was picked even though only files
       * are displayed. Defaults to `selected`.
       */
      readonly picked?: readonly string[];
      readonly shows: (path: string) => boolean;
    }
  | { readonly kind: 'file'; readonly view: V; readonly path: string }
  | { readonly kind: 'other'; readonly view: V };

/**
 * What the shown files came from: the main view, its content or file, whether they are this grid's selection,
 * and its raw selection at that time (`picked`; defaults to the shown files).
 */
export interface Basis<V> {
  readonly view: V;
  readonly key: string;
  readonly selection: boolean;
  readonly picked?: readonly string[];
}

export interface Shown<V> {
  readonly paths: readonly string[];
  readonly basis: Basis<V> | null;
}

/**
 * The trigger: `select` means grid `from` changed its selection; `activate` means the main view or its file
 * changed; `clear` is a click on empty space in grid `from`, which clears the grid selection.
 */
export type Cause<V> =
  { readonly kind: 'select' | 'clear'; readonly from: V } | { readonly kind: 'activate' };

/**
 * The panel after a selection change in the same grid with the same content: if shown files left the grid and
 * nothing new was picked, `null` keeps what is shown; otherwise the selection. "New" is judged by the raw
 * selection `picked`, with folders: a folder tile is new too, just not a file, and the panel says "Select a
 * file", like Obsidian's sidebar views on `file-open` of a non-file. It is compared with the shown files and
 * the raw selection they were taken with (`before`): a folder selected together with the removed file is not
 * new. Called on every trigger of the same grid (returning to it, every marquee frame), and the selection can
 * be the whole vault (50k files), so comparison uses sets in linear time; an array search inside the loop
 * froze the window for a second at 10k selected.
 */
export function panelAfterSelection(
  shown: readonly string[],
  selected: readonly string[],
  shows: (path: string) => boolean,
  picked: readonly string[] = selected,
  before: readonly string[] = shown,
): string[] | null {
  const now = new Set(selected);
  const lost = shown.filter((path) => !now.has(path));
  if (lost.length === 0) return [...selected];
  const was = new Set(before);
  for (const path of shown) was.add(path);
  const nothingNew = picked.every((path) => was.has(path));
  return nothingNew && lost.every((path) => !shows(path)) ? null : [...selected];
}

/** What the panel shows for `cause` with main view `main`; `null` keeps it as is. */
export function nextShown<V>(shown: Shown<V>, main: MainView<V> | null, cause: Cause<V>): Shown<V> | null {
  if (!main || main.kind === 'other') return null;
  const { basis } = shown;
  const key = keyOf(main);
  const same = basis !== null && basis.view === main.view && basis.key === key;
  if (main.kind === 'file') {
    if (cause.kind !== 'activate' || same) return null;
    return { paths: [main.path], basis: { view: main.view, key, selection: false } };
  }
  // A background grid is not the main view: the panel ignores its selection.
  if (cause.kind !== 'activate' && cause.from !== main.view) return null;
  if (cause.kind !== 'clear' && basis !== null && same) {
    if (
      basis.selection &&
      panelAfterSelection(shown.paths, main.selected, main.shows, main.picked, basis.picked) === null
    )
      return null;
    // Files taken from the menu with this same grid stay until its selection changes.
    if (!basis.selection && cause.kind === 'activate') return null;
  }
  return { paths: [...main.selected], basis: selectionBasis(main, key) };
}

/** Shown files as the selection of grid `main`, with its raw selection if it gave one. */
function selectionBasis<V>(main: Extract<MainView<V>, { kind: 'grid' }>, key: string): Basis<V> {
  const basis = { view: main.view, key, selection: true };
  return main.picked ? { ...basis, picked: main.picked } : basis;
}

/**
 * Shown files after Obsidian renames or moves `from` → `to`: shown paths and the basis's raw selection follow
 * the same rule as the grid selection (`movedPath`: the path itself and everything under `from/`). The grid
 * moves its selection itself (src/assets/grid/selection.ts); without this, a renamed folder selected together
 * with a removed file would read as a new pick and the panel would say "Select a file".
 */
export function renamedShown<V>(shown: Shown<V>, from: string, to: string): Shown<V> {
  const move = (paths: readonly string[]): string[] => paths.map((path) => movedPath(path, from, to));
  const { basis } = shown;
  return {
    paths: move(shown.paths),
    basis: basis?.picked ? { ...basis, picked: move(basis.picked) } : basis,
  };
}

/** The "File panel" menu item: shows `paths` and remembers the main view it was chosen in. */
export function picked<V>(paths: readonly string[], main: MainView<V> | null): Shown<V> {
  if (!main || main.kind === 'other') return { paths: [...paths], basis: null };
  const key = keyOf(main);
  if (main.kind === 'grid' && samePaths(paths, main.selected))
    return { paths: [...paths], basis: selectionBasis(main, key) };
  return { paths: [...paths], basis: { view: main.view, key, selection: false } };
}

/** The same paths, in any order. */
export function samePaths(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((path) => set.has(path));
}

function keyOf<V>(main: Exclude<MainView<V>, { kind: 'other' }>): string {
  return main.kind === 'grid' ? main.state : main.path;
}
