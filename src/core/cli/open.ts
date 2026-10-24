// Result of `buba:open`, read from the leaf after the call: while a previous `setViewState`
// is running, Obsidian silently skips the next one and still reports success, so success is
// read from the leaf state, not from the call's answer. There is no retry: it would
// override whoever opened a folder at the same moment. No `obsidian` import.
import { GRID_VIEW_TYPE, normalizeGridViewState } from '../layout/view-state.ts';
import { CliError, type Fields } from './answer.ts';

/** View type of Obsidian's built-in canvas board. */
export const CANVAS_VIEW_TYPE = 'canvas';

/** Leaf state as `WorkspaceLeaf.getViewState()` returns it. */
export interface LeafViewState {
  readonly type: string;
  readonly state?: unknown;
}

/**
 * The grid is open on `folder`: the leaf is a grid, its state folder is that folder, and there is no foreign
 * source. Otherwise `not-applied` with what is open: for a grid its folder (`null` means all files) and
 * source kind if any; for another view its type.
 */
export function checkGridOpened(folder: string, leaf: LeafViewState): void {
  if (leaf.type !== GRID_VIEW_TYPE) throw notApplied(folder, { view: leaf.type });
  const { folder: shown, source } = normalizeGridViewState(leaf.state);
  if (shown === folder && !source) return;
  throw notApplied(folder, { view: leaf.type, folder: shown, ...(source && { source: source.kind }) });
}

/** Board `path` is open: the view is a canvas with that file. Else `not-applied` with view type and file. */
export function checkCanvasOpened(
  path: string,
  view: { readonly type: string; readonly file: string | null },
): void {
  if (view.type === CANVAS_VIEW_TYPE && view.file === path) return;
  throw notApplied(path, { view: view.type, path: view.file });
}

function notApplied(requested: string, opened: Fields): CliError {
  return new CliError('not-applied', requested, { opened });
}
