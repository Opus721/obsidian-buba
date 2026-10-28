// Grid tile selection on the model in src/core/selection/selection.ts: a click selects one tile, Ctrl (Cmd on
// macOS) adds or removes, Shift selects the run from the anchor, a press on empty space plus movement draws a
// marquee, Ctrl+A (Cmd+A) selects every tile while the grid has focus. Each grid view has its own selection: the view gets `selectedPaths()`, and every change fires
// `buba:selection-change` (view, paths in grid order). Just added files become the selection, and the first
// of them in grid order is scrolled into view (`buba:added-select`). The marquee works on the rectangles of the
// whole layout (`tileRects()`), not on page elements: the grid draws only visible tiles. Handlers are
// delegated by `.buba-tile[data-path]` on the document of every Obsidian window, including ones opened later.
import { ItemView, Keymap, type Events, type Plugin } from 'obsidian';
import { ADDED_SELECT, SELECTION_CHANGE, SELECTION_RESTORE } from '../../core/layout/grid-events.ts';
import {
  clear,
  extend,
  inOrder,
  marquee,
  prune,
  rename,
  restore,
  select,
  selectAll,
  toggle,
  type Rect,
  type Selection,
} from '../../core/selection/selection.ts';
import { isTypingTarget } from '../../core/tags/keys.ts';
import { BATCH_FRAME_MS, batchRunning } from '../../platform/files/batch.ts';
import { settingsOf } from '../../platform/settings.ts';
import type { BubaAssets, BubaGridView } from '../api.ts';
import {
  DRAG_PX,
  firstOfSeries,
  onScrollbar,
  pressAt,
  SERIES,
  watchSeries,
  type Press,
} from './click-series.ts';
import './selection.css';

/**
 * Selection change event; the name lives in the core (src/core/layout/grid-events.ts), selection tests import
 * it from here.
 */
export { SELECTION_CHANGE };

/** A grid view with an Obsidian leaf, as returned by `assets.gridViews()`. */
export type GridLeafView = ItemView & BubaGridView;

/**
 * Where the event happened: the grid view, its body and the path of the tile under the pointer; `null` for
 * empty space. For the second and later clicks of a series it is the place of the first press
 * (click-series.ts).
 */
export interface GridHit {
  view: GridLeafView;
  body: HTMLElement;
  path: string | null;
}

const SELECTED = ['is-selected'];
const NONE: string[] = [];
/** Body redraw: a tile took a path or was hidden. */
const REPAINT: MutationObserverInit = {
  subtree: true,
  attributes: true,
  attributeFilter: ['data-path', 'style'],
};
/**
 * How many frames just added files wait for the grid to show them: it draws them in the frame after the vault
 * event, a phone body coasting after a scroll only once it stops.
 */
const ADDED_FRAMES = 120;
/**
 * How many frames reconciliation waits for the view to draw a rename of a selected path; then it reconciles
 * as is.
 */
const WAIT_FRAMES = 60;

interface ViewSelection {
  sel: Selection;
  /** Mark function for `setTileMarks`, one per view, reading the current selection. */
  readonly marks: (path: string) => string[];
  /** Reconciles the selection with the content after a body redraw; observes while anything is selected. */
  readonly repaint: MutationObserver;
  watching: boolean;
  /**
   * Reconciliation runs in the frame after the redraw, in the same frame queue as the grid view: a vault
   * event changes its content only in its next frame, and scrolling before that redraws the body with the old
   * paths.
   */
  frame: number;
  /**
   * Renamed selected paths: new path → old paths. While the view shows an old path its content predates the
   * rename (the next batch move arrived before the view redrew for it), and reconciling against it would drop
   * the new path from the selection.
   */
  readonly moved: Map<string, Set<string>>;
  /** How many frames reconciliation has waited for the view to redraw. */
  waited: number;
  /** A marquee is being dragged and owns the selection. */
  dragging: boolean;
  /** The event waits for a redraw: the view still shows old paths of a just renamed file. */
  pending: boolean;
}

const selections = new WeakMap<BubaGridView, ViewSelection>();

export function registerSelection(plugin: Plugin, assets: BubaAssets): void {
  const { vault, workspace } = plugin.app;
  const install = (): void => {
    for (const view of gridViews(assets)) stateOf(view);
  };
  workspace.onLayoutReady(install);
  plugin.registerEvent(workspace.on('layout-change', install));
  workspace.onLayoutReady(() => wireSelectAll(plugin, assets));
  plugin.registerEvent(workspace.on('layout-change', () => wireSelectAll(plugin, assets)));

  onGridEvent(plugin, assets, 'click', (evt, { view, path }) => {
    if (path === null || evt.button !== 0) return;
    const state = stateOf(view);
    const mod = Keymap.isModifier(evt, 'Mod');
    const next = evt.shiftKey
      ? extend(state.sel, view.pathsInOrder(), path, mod)
      : mod
        ? toggle(state.sel, path)
        : select(state.sel, path);
    change(view, state, next);
  });
  onGridEvent(plugin, assets, 'mousedown', (evt, hit) => {
    if (evt.button === 0 && hit.path === null && !onScrollbar(hit.body, evt)) dragMarquee(hit, evt);
  });

  // Tab back/forward step: keep the paths the grid shows and the Shift anchor if the grid shows it; a new
  // view gets this before `layout-change`.
  plugin.registerEvent(
    (workspace as Events).on(SELECTION_RESTORE, (target, paths, anchor) => {
      const view = gridViews(assets).find((each) => each === target);
      if (!view || !Array.isArray(paths)) return;
      const shown = new Set(view.pathsInOrder());
      const kept = paths.filter((path): path is string => typeof path === 'string');
      const next = restore(kept, typeof anchor === 'string' ? anchor : null, (path) => shown.has(path));
      change(view, stateOf(view), next);
    }),
  );
  // Just added files: in the grid they were added through, or, from the tree and folder menus (`null`), in
  // every grid that shows them.
  plugin.registerEvent(
    (workspace as Events).on(ADDED_SELECT, (target, paths) => {
      if (!Array.isArray(paths)) return;
      const added = new Set(paths.filter((path): path is string => typeof path === 'string'));
      if (added.size === 0) return;
      for (const view of gridViews(assets))
        if (target === null || view === target) selectAdded(assets, view, added);
    }),
  );
  plugin.registerEvent(
    vault.on('rename', (file, oldPath) => {
      for (const view of gridViews(assets)) {
        const state = selections.get(view);
        if (!state || !track(state, oldPath, file.path)) continue;
        change(view, state, rename(state.sel, oldPath, file.path), true);
        schedule(view, state);
      }
    }),
  );
  plugin.registerEvent(
    vault.on('delete', (file) => {
      const kept = (path: string): boolean => path !== file.path && !path.startsWith(`${file.path}/`);
      for (const view of gridViews(assets)) {
        const state = selections.get(view);
        if (state) change(view, state, prune(state.sel, kept));
      }
    }),
  );
}

/** Selects every tile of the view, folders included, as Ctrl+A in Explorer; the Shift anchor is cleared. */
export function selectAllTiles(view: GridLeafView): void {
  change(view, stateOf(view), selectAll(view.pathsInOrder()));
}

const selectAllWired = new WeakSet<BubaGridView>();

/**
 * Ctrl+A (Cmd+A) on the `scope` of every grid view, once per view, like Delete in src/assets/actions/menu-items.ts.
 * By `code`, so it works with a Russian layout too; in a text field, or with grid keys off on Buba's settings
 * page, the key goes on to Obsidian. The command "Select all tiles" (commands.ts) takes a key of the user's own.
 */
function wireSelectAll(plugin: Plugin, assets: BubaAssets): void {
  for (const view of gridViews(assets)) {
    const { scope } = view;
    if (!scope || selectAllWired.has(view)) continue;
    selectAllWired.add(view);
    const handler = scope.register(null, null, (evt) => {
      if (
        evt.code !== 'KeyA' ||
        !Keymap.isModifier(evt, 'Mod') ||
        evt.shiftKey ||
        evt.altKey ||
        evt.isComposing ||
        !settingsOf(plugin).gridKeys ||
        isTypingTarget(evt.target as Element | null)
      )
        return undefined;
      if (!evt.repeat) selectAllTiles(view);
      return false;
    });
    view.register(() => scope.unregister(handler));
  }
}

/**
 * The selection for an action on a tile (menu, drag): a tile outside the selection becomes the only selected
 * one. Paths in grid order.
 */
export function selectedFor(view: GridLeafView, path: string): string[] {
  const state = stateOf(view);
  if (!state.sel.selected.has(path)) change(view, state, select(state.sel, path));
  return inOrder(state.sel, view.pathsInOrder());
}

/**
 * Listens to an event on all grid bodies, delegated on the document of every Obsidian window: the main one,
 * already open ones and ones opened later (`window-open`); a closed window is released (`window-close`). The
 * second and later clicks of a series (click-series.ts) arrive with the place of its first press wherever the
 * pointer is now: a double click opens the tile of the first click, and the second click neither moves the
 * selection nor clears it with a press on empty space.
 */
export function onGridEvent<K extends keyof DocumentEventMap>(
  plugin: Plugin,
  assets: BubaAssets,
  type: K,
  listener: (evt: DocumentEventMap[K], hit: GridHit) => void,
): void {
  const clicks = SERIES.has(type);
  const { workspace } = plugin.app;
  const attached = new Map<Document, () => void>();
  const attach = (doc: Document): void => {
    if (attached.has(doc)) return;
    const unwatch = clicks ? watchSeries(doc) : null;
    const handler = (evt: DocumentEventMap[K]): void => {
      const first = clicks ? firstOfSeries(doc, evt) : undefined;
      const hit = gridHit(assets, first === undefined ? pressAt(evt.target) : first);
      if (hit) listener(evt, hit);
    };
    doc.addEventListener(type, handler);
    attached.set(doc, () => {
      doc.removeEventListener(type, handler);
      unwatch?.();
    });
  };
  attach(document);
  workspace.iterateAllLeaves((leaf) => attach(leaf.view.containerEl.doc));
  plugin.registerEvent(workspace.on('window-open', (win) => attach(win.doc)));
  plugin.registerEvent(
    workspace.on('window-close', (win) => {
      attached.get(win.doc)?.();
      attached.delete(win.doc);
    }),
  );
  plugin.register(() => {
    for (const detach of attached.values()) detach();
    attached.clear();
  });
}

/**
 * Selects just added files once the view shows them, as Finder and Explorer do after a paste: all of them stay
 * selected, the first in grid order comes to the top edge if it is not fully visible (`reveal`), and the anchor
 * is on it, so Shift extends from there. The view draws them in a later frame, so this waits up to
 * `ADDED_FRAMES` frames for at least one; a view that never shows them (another folder, a type filter that
 * hides them) keeps its selection and place.
 */
function selectAdded(assets: BubaAssets, view: GridLeafView, added: ReadonlySet<string>, frames = 0): void {
  window.requestAnimationFrame(() => {
    if (!gridViews(assets).includes(view)) return;
    const shown = view.pathsInOrder().filter((path) => added.has(path));
    const [first] = shown;
    if (first === undefined) {
      if (frames < ADDED_FRAMES) selectAdded(assets, view, added, frames + 1);
      return;
    }
    change(
      view,
      stateOf(view),
      restore(shown, first, () => true),
    );
    view.reveal(first);
  });
}

function gridViews(assets: BubaAssets): GridLeafView[] {
  return assets.gridViews().filter((view): view is GridLeafView => view instanceof ItemView);
}

/** The press place in an open grid view; `null` if there is no body or its view is closed. */
function gridHit(assets: BubaAssets, at: Press | null): GridHit | null {
  const view = at && gridViews(assets).find((each) => each.containerEl.contains(at.body));
  return view ? { view, body: at.body, path: at.path } : null;
}

function stateOf(view: GridLeafView): ViewSelection {
  const known = selections.get(view);
  if (known) return known;
  const state: ViewSelection = {
    sel: clear(),
    marks: (path) => (state.sel.selected.has(path) ? SELECTED : NONE),
    repaint: new MutationObserver(() => schedule(view, state)),
    watching: false,
    frame: 0,
    moved: new Map(),
    waited: 0,
    dragging: false,
    pending: false,
  };
  selections.set(view, state);
  view.selectedPaths = () => inOrder(state.sel, view.pathsInOrder());
  view.selectionAnchor = () => state.sel.anchor;
  view.setTileMarks(state.marks);
  return state;
}

/**
 * Sets the selection; on change, marks visible tiles and fires the event, with `later` after the view
 * redraws.
 */
function change(view: GridLeafView, state: ViewSelection, next: Selection, later = false): void {
  const prev = state.sel.selected;
  state.sel = next;
  if (prev.size === next.selected.size && [...next.selected].every((path) => prev.has(path))) return;
  view.setTileMarks(state.marks);
  const body = next.selected.size > 0 ? view.containerEl.querySelector('.buba-grid-scroller') : null;
  if (body && !state.watching) state.repaint.observe(body, REPAINT);
  if (!body && state.watching) state.repaint.disconnect();
  state.watching = body !== null;
  if (later) state.pending = true;
  else announce(view, state);
}

function announce(view: GridLeafView, state: ViewSelection): void {
  state.pending = false;
  view.app.workspace.trigger(SELECTION_CHANGE, view, inOrder(state.sel, view.pathsInOrder()));
}

/**
 * Reconciliation in the next frame, one per frame; while a batch of moves runs, one per `BATCH_FRAME_MS`
 * (src/platform/files/batch.ts): each reconciliation announces the selection, and the file panel redraws.
 */
function schedule(view: GridLeafView, state: ViewSelection): void {
  if (state.frame) return;
  const run = (): void => {
    state.frame = 0;
    reconcile(view, state);
  };
  state.frame = batchRunning() ? window.setTimeout(run, BATCH_FRAME_MS) : window.requestAnimationFrame(run);
}

/**
 * Records a rename of a selected path, or of a folder with selected paths inside; `false` if no selected path
 * was hit.
 */
function track(state: ViewSelection, from: string, to: string): boolean {
  let hit = false;
  for (const path of state.sel.selected) {
    if (path !== from && !path.startsWith(`${from}/`)) continue;
    hit = true;
    const next = to + path.slice(from.length);
    const olds = state.moved.get(path) ?? new Set<string>();
    state.moved.delete(path);
    olds.add(path);
    olds.delete(next); // renamed back to the old name, which the view will show
    if (olds.size > 0) state.moved.set(next, olds);
  }
  return hit;
}

/**
 * The body was redrawn and the content may have changed: paths missing from the new `pathsInOrder()` leave
 * the selection, and a deferred event fires now. If the view still shows a renamed path's old name, wait for
 * its redraw: reconciling against old content would drop the new path.
 */
function reconcile(view: GridLeafView, state: ViewSelection): void {
  if (state.dragging) return;
  const order = view.pathsInOrder();
  if (state.moved.size > 0) {
    const olds = new Set<string>();
    for (const paths of state.moved.values()) for (const path of paths) olds.add(path);
    if (order.some((path) => olds.has(path)) && ++state.waited < WAIT_FRAMES) return schedule(view, state);
    state.moved.clear();
    state.waited = 0;
  }
  let found = 0;
  for (const path of order) if (state.sel.selected.has(path)) found += 1;
  if (found < state.sel.selected.size) {
    const shown = new Set(order);
    const kept = (path: string): boolean => shown.has(path);
    change(view, state, prune(state.sel, kept));
  }
  if (state.pending) announce(view, state);
}

/** A window point in body coordinates, like `tileRects()`: from the top left of the scrolled content. */
function inBody(body: HTMLElement, x: number, y: number): { x: number; y: number } {
  const box = body.getBoundingClientRect();
  return {
    x: x - box.left - body.clientLeft + body.scrollLeft,
    y: y - box.top - body.clientTop + body.scrollTop,
  };
}

/**
 * Marquee from the press point on empty space to the pointer; the corner under the pointer is clamped to the
 * visible part of the body, beyond that scrolling extends the marquee. Without movement it is a click on
 * empty space: the selection is cleared (kept with Ctrl).
 */
function dragMarquee({ view, body }: GridHit, down: MouseEvent): void {
  const state = stateOf(view);
  const { doc, win } = body;
  const additive = Keymap.isModifier(down, 'Mod');
  const base = state.sel;
  const start = inBody(body, down.clientX, down.clientY);
  let pointer = { x: down.clientX, y: down.clientY };
  let box: HTMLElement | null = null;
  let frame = 0;
  const update = (): void => {
    frame = 0;
    const at = inBody(body, pointer.x, pointer.y);
    const x = Math.min(Math.max(at.x, body.scrollLeft), body.scrollLeft + body.clientWidth);
    const y = Math.min(Math.max(at.y, body.scrollTop), body.scrollTop + body.clientHeight);
    if (!box) {
      if (Math.hypot(x - start.x, y - start.y) < DRAG_PX) return;
      box = doc.body.createDiv({ cls: 'buba-marquee' });
      state.dragging = true;
    }
    const rect = { left: start.x, top: start.y, width: x - start.x, height: y - start.y };
    change(view, state, marquee(base, rect, view.tileRects(), additive));
    place(box, body, rect);
  };
  const schedule = (): void => {
    if (!frame) frame = win.requestAnimationFrame(update);
  };
  const move = (evt: MouseEvent): void => {
    if ((evt.buttons & 1) === 0) return finish();
    pointer = { x: evt.clientX, y: evt.clientY };
    schedule();
  };
  const up = (evt: MouseEvent): void => {
    if (evt.button === 0) finish();
  };
  const finish = (): void => {
    doc.removeEventListener('mousemove', move);
    doc.removeEventListener('mouseup', up);
    body.removeEventListener('scroll', schedule);
    if (frame) {
      win.cancelAnimationFrame(frame);
      update();
    }
    if (box) {
      box.remove();
      state.dragging = false;
    } else if (!additive) change(view, state, clear());
  };
  doc.addEventListener('mousemove', move);
  doc.addEventListener('mouseup', up);
  body.addEventListener('scroll', schedule);
}

/**
 * The marquee on screen, over the body and within its visible bounds: the part past the edge is scrolled
 * away.
 */
function place(el: HTMLElement, body: HTMLElement, rect: Rect): void {
  const box = body.getBoundingClientRect();
  const clip = (value: number, max: number): number => Math.min(Math.max(value, 0), max);
  const left = clip(Math.min(rect.left, rect.left + rect.width) - body.scrollLeft, body.clientWidth);
  const right = clip(Math.max(rect.left, rect.left + rect.width) - body.scrollLeft, body.clientWidth);
  const top = clip(Math.min(rect.top, rect.top + rect.height) - body.scrollTop, body.clientHeight);
  const bottom = clip(Math.max(rect.top, rect.top + rect.height) - body.scrollTop, body.clientHeight);
  el.setCssStyles({
    left: `${box.left + body.clientLeft + left}px`,
    top: `${box.top + body.clientTop + top}px`,
    width: `${right - left}px`,
    height: `${bottom - top}px`,
  });
}
