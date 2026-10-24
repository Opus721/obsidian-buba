// Per-place grid views: one place view memory per plugin, started at module load (`registerGridSources`) like
// folder renames. It is stored as `buba-grid-views` in the device's local storage via
// `App.loadLocalStorage`/`saveLocalStorage`, like Obsidian's note folds and canvas lock: separate on each
// device, not carried by Sync. The rules are in src/core/layout/place-views.ts; here are reading and writing,
// the first run, folder moves, and the grid views as subscribers.
import { TFolder, type Plugin } from 'obsidian';
import {
  commonLook,
  differsFromCommon,
  forget,
  hasLook,
  lookFor,
  lookOf,
  makeCommon,
  movePlace,
  PLACE_VIEWS_KEY,
  placeKey,
  readPlaceViews,
  remember,
  seed,
  type PlaceLook,
  type PlaceViews,
} from '../../core/layout/place-views.ts';
import {
  GRID_VIEW_TYPE,
  normalizeGridViewState,
  TILE_SIZE_DEFAULT,
  type GridViewState,
} from '../../core/layout/view-state.ts';
import type { BubaAssets, GridSource, GridSourceProvider } from '../api.ts';

/**
 * What the grid shows: a module source if its kind is registered; otherwise the folder from `folder` and
 * `deep`.
 */
export interface Shown {
  readonly source: GridSource;
  readonly provider: GridSourceProvider | undefined;
  readonly foreign: boolean;
}

export function shownSource(state: GridViewState, assets: BubaAssets): Shown {
  const own = state.source;
  const provider = own && assets.gridSource(own.kind);
  if (own && provider) return { source: own, provider, foreign: true };
  const { folder, deep } = state;
  const source: GridSource =
    folder === null ? { kind: 'all' } : { kind: 'folder', path: folder, withSubfolders: deep };
  return { source, provider: assets.gridSource(source.kind), foreign: false };
}

/** Place key by what the grid shows: a disabled module's source maps to the folder the grid shows instead. */
export function placeKeyOf(state: GridViewState, assets: BubaAssets): string {
  return placeKey(shownSource(state, assets).source);
}

export interface PlaceMemory {
  /**
   * The place's view; `null` on the first run while the common view is unknown: the tab shows the view it
   * got.
   */
  lookFor(key: string): PlaceLook | null;
  /**
   * The view differs from the common one, so the place has its own: the badge and "Reset to common view",
   * "Make this view common".
   */
  differs(look: PlaceLook): boolean;
  /**
   * A tab received a state (`setState`). First run: until the layout is ready, the tab keeps the view it had
   * in the layout; with no grid tabs at load, the first non-empty state becomes the common view.
   */
  arrived(state: unknown): void;
  remember(key: string, look: PlaceLook): void;
  forget(key: string): void;
  makeCommon(key: string, look: PlaceLook): void;
  /** Tile size a new folder opens with: the common view's; 160 when no common view is set. */
  standardSize(): number;
  /**
   * The memory changed (a place view in another tab, the common view, the first run); returns the
   * unsubscribe.
   */
  onChange(listener: () => void): () => void;
}

/**
 * `loading`: there was no record at load and the layout is not ready: tabs show the view they got as is, and
 * the memory collects their states. `waiting`: the layout is ready but there were no grid tabs with a view:
 * the first non-empty state becomes common. `ready`: the common view is known.
 */
type Phase = 'loading' | 'waiting' | 'ready';

const memories = new WeakMap<Plugin, PlaceMemory>();

/**
 * "Standard tile size", the size a new folder opens with: the core `lookFor` gives a place without its own
 * view the common view, and without a common view the default, 160.
 */
export function standardTileSize(plugin: Plugin, assets: BubaAssets): number {
  return placeViewsOf(plugin, assets).standardSize();
}

/**
 * The plugin's place view memory; first called at module load (`registerGridSources`), in tests from the
 * view.
 */
export function placeViewsOf(plugin: Plugin, assets: BubaAssets): PlaceMemory {
  const known = memories.get(plugin);
  if (known) return known;
  const memory = createMemory(plugin, assets);
  memories.set(plugin, memory);
  return memory;
}

function createMemory(plugin: Plugin, assets: BubaAssets): PlaceMemory {
  const { app } = plugin;
  const stored: unknown = app.loadLocalStorage(PLACE_VIEWS_KEY);
  let views: PlaceViews = readPlaceViews(stored);
  let phase: Phase = stored === null ? 'loading' : 'ready';
  const listeners = new Set<() => void>();
  const keyOf = (state: unknown) => placeKeyOf(normalizeGridViewState(state), assets);
  /** First run: non-empty states that tabs received from the layout, in order. */
  const restored: { key: string; state: unknown }[] = [];

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  /** Subscribers are woken once, after the vault event has gone through all its listeners. */
  let waking = false;
  const wakeLater = (): void => {
    if (waking) return;
    waking = true;
    queueMicrotask(() => {
      waking = false;
      notify();
    });
  };
  /**
   * A new record goes to local storage and subscribers; the same one does nothing. Obsidian swallows write
   * errors itself.
   */
  const set = (next: PlaceViews, wake: 'now' | 'later' | 'no' = 'now'): void => {
    if (next === views) return;
    views = next;
    app.saveLocalStorage(PLACE_VIEWS_KEY, views);
    if (wake === 'now') notify();
    else if (wake === 'later') wakeLater();
  };
  const act = (next: () => PlaceViews): void => {
    if (phase === 'waiting') phase = 'ready';
    set(next());
  };

  if (phase === 'loading') {
    // First run: once Obsidian has laid out the window, the tabs' views as they were are spread over their
    // places, before the first navigation could carry one folder's view to another. Built tabs use the state
    // they got from the layout; deferred ones (`leaf.isDeferred`: Obsidian does not build a background tab
    // until shown) use the saved state.
    app.workspace.onLayoutReady(() => {
      const deferred = app.workspace
        .getLeavesOfType(GRID_VIEW_TYPE)
        .filter((leaf) => leaf.isDeferred)
        .map((leaf) => leaf.getViewState().state)
        .filter(hasLook)
        .map((state) => ({ key: keyOf(state), state }));
      const tabs = [...restored.splice(0), ...deferred];
      if (tabs.length === 0) {
        phase = 'waiting';
        return;
      }
      phase = 'ready';
      set(seed(views, tabs));
    });
  }

  // The view follows the folder; subscribers wake after the `rename` event has gone through all listeners. By
  // then a tab with this folder has followed it (the view's `#renamed`) and finds the same view under the new
  // path; woken before its `#renamed`, it would look under the old path, find nothing and fall back to
  // common. A tab left on the path of a deleted folder that another folder was renamed into gets the place's
  // view, like a new tab of that place.
  plugin.registerEvent(
    app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFolder) set(movePlace(views, oldPath, file.path), 'later');
    }),
  );

  return {
    lookFor: (key) => (phase === 'ready' ? lookFor(views, key) : null),
    differs: (look) => phase === 'ready' && differsFromCommon(views, look),
    arrived(state) {
      if (!hasLook(state)) return;
      if (phase === 'loading') restored.push({ key: keyOf(state), state });
      if (phase !== 'waiting') return;
      phase = 'ready';
      // No subscribers: the tab that got the state has not applied it yet, and other tabs' views did not
      // change.
      set(seed(views, [{ key: keyOf(state), state }]), 'no');
    },
    remember: (key, look) => act(() => remember(views, key, lookOf(look))),
    forget: (key) => act(() => forget(views, key)),
    makeCommon: (key, look) => act(() => makeCommon(views, key, lookOf(look))),
    standardSize: () => commonLook(views)?.size ?? TILE_SIZE_DEFAULT,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
