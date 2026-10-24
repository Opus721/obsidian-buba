// Selection model of grid tiles, without the `obsidian` import. Click, Ctrl and Shift from the anchor tile
// work like the W3C ARIA APG multi-select listbox (https://www.w3.org/WAI/ARIA/apg/patterns/listbox/) and
// file managers. The marquee is computed from the geometry of the whole layout, not from elements on screen,
// because the grid renders only visible tiles. Selections are immutable: every function returns a new one.
// Paths are from the vault root.
import { movedPath } from '../layout/view-state.ts';

export interface Selection {
  readonly selected: ReadonlySet<string>;
  /** Anchor tile: Shift selects a range from it. */
  readonly anchor: string | null;
}

/** A rectangle in layout coordinates; a marquee dragged left or up has negative sizes. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A layout tile, including one scrolled out of view. */
export interface TileRect extends Rect {
  path: string;
}

export function clear(): Selection {
  return { selected: new Set(), anchor: null };
}

/** Click: one tile, which becomes the anchor. */
export function select(_sel: Selection, path: string): Selection {
  return { selected: new Set([path]), anchor: path };
}

/** Ctrl: toggles a tile and makes it the anchor. */
export function toggle(sel: Selection, path: string): Selection {
  const selected = new Set(sel.selected);
  if (!selected.delete(path)) selected.add(path);
  return { selected, anchor: path };
}

/** Shift: the range in `order` from the anchor to `path` inclusive; with Ctrl, added to the selection. */
export function extend(sel: Selection, order: readonly string[], path: string, additive: boolean): Selection {
  const from = sel.anchor === null ? -1 : order.indexOf(sel.anchor);
  const to = order.indexOf(path);
  if (from < 0 || to < 0) return select(sel, path);
  const selected = new Set(additive ? sel.selected : []);
  for (const each of order.slice(Math.min(from, to), Math.max(from, to) + 1)) selected.add(each);
  return { selected, anchor: sel.anchor };
}

/**
 * Marquee: tiles of the whole layout that intersect it (touching an edge does not count); with Ctrl, added.
 */
export function marquee(
  sel: Selection,
  rect: Rect,
  items: readonly TileRect[],
  additive: boolean,
): Selection {
  const left = Math.min(rect.left, rect.left + rect.width);
  const right = Math.max(rect.left, rect.left + rect.width);
  const top = Math.min(rect.top, rect.top + rect.height);
  const bottom = Math.max(rect.top, rect.top + rect.height);
  const selected = new Set(additive ? sel.selected : []);
  for (const item of items) {
    if (
      item.left < right &&
      item.left + item.width > left &&
      item.top < bottom &&
      item.top + item.height > top
    ) {
      selected.add(item.path);
    }
  }
  return { selected, anchor: sel.anchor };
}

export function selectAll(order: readonly string[]): Selection {
  return { selected: new Set(order), anchor: null };
}

/**
 * Selection from a tab history step (back, forward): the paths from `paths` that the grid shows (`shown`).
 * The anchor is `anchor` if the grid shows it (an anchor can be a tile unselected with Ctrl-click). Otherwise
 * the only selected path, so a step saved without an anchor by older builds behaves like a click; otherwise
 * no anchor, and Shift selects a single tile. `shown` is a set lookup: up to 50k paths can be selected.
 */
export function restore(
  paths: readonly string[],
  anchor: string | null,
  shown: (path: string) => boolean,
): Selection {
  const kept = paths.filter(shown);
  const from = anchor !== null && shown(anchor) ? anchor : kept.length === 1 ? kept[0]! : null;
  return { selected: new Set(kept), anchor: from };
}

/** The selection in grid order, for batch actions and the viewer. */
export function inOrder(sel: Selection, order: readonly string[]): string[] {
  return order.filter((path) => sel.selected.has(path));
}

/** Drops paths that no longer exist; if the anchor is gone, there is no anchor. */
export function prune(sel: Selection, exists: (path: string) => boolean): Selection {
  const selected = new Set([...sel.selected].filter(exists));
  return { selected, anchor: sel.anchor !== null && exists(sel.anchor) ? sel.anchor : null };
}

/** The selection follows a rename of a file or folder: `from` and everything under `from + '/'`. */
export function rename(sel: Selection, from: string, to: string): Selection {
  const move = (path: string) => movedPath(path, from, to);
  return {
    selected: new Set([...sel.selected].map(move)),
    anchor: sel.anchor === null ? null : move(sel.anchor),
  };
}
