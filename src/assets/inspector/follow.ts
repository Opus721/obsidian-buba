// What the file panel shows: the main grid's selection, the main view's file, or the file from the "File
// panel" menu item. The rule is in src/core/inspector/follow.ts; here are the Obsidian listeners and the
// display. The main view is chosen like the file of Obsidian's "Backlinks" (`getActiveFileView`, Obsidian
// 1.13): the active leaf if its view is navigable (`View.navigation`), otherwise the most recent leaf of the
// main area (`getMostRecentLeaf`). The grid contract: open views from `assets.gridViews()`, the
// `buba:selection-change` and `buba:grid-state-change` events, presses on the grid body; what a grid shows is
// the content key of its `getState()` (`gridContentKey`).
import { ItemView, Platform, TFile, type Events, type Plugin, type View } from 'obsidian';
import {
  nextShown,
  picked,
  renamedShown,
  samePaths,
  type Cause,
  type MainView,
  type Shown,
} from '../../core/inspector/follow.ts';
import { GRID_STATE_CHANGE, SELECTION_CHANGE } from '../../core/layout/grid-events.ts';
import { gridContentKey, normalizeGridViewState } from '../../core/layout/view-state.ts';
import { inDataDir, tagKey } from '../../core/storage/types.ts';
import type { BubaAssets, BubaGridView } from '../api.ts';
import { onGridEvent } from '../grid/selection.ts';
import { INSPECTOR_VIEW_TYPE, InspectorView } from './view.ts';

export interface PanelFollow {
  /** What the panel shows; a freshly opened panel fills itself from this. */
  paths: () => readonly string[];
  /** "File panel" menu item: slide the panel out with these files. */
  pick(paths: readonly string[]): Promise<void>;
  /** The single tag of the last main grid; focusing the panel does not make it a source. */
  currentTag(): string | null;
  onSourceChange(listener: () => void): () => void;
}

export function registerFollow(plugin: Plugin, assets: BubaAssets): PanelFollow {
  const { vault, workspace } = plugin.app;
  let shown: Shown<View> = { paths: [], basis: null };

  // Tags, rating and comments are for files: the panel does not show folders or journals in Buba data folders
  // (`__buba-data/`, legacy `Buba/`).
  const filesOf = (paths: readonly string[]): string[] =>
    paths.filter((path) => !inDataDir(path) && vault.getFileByPath(path) !== null);

  const mainView = (): View | null => {
    const active = workspace.getActiveViewOfType(ItemView);
    if (active?.navigation) return active;
    return workspace.getMostRecentLeaf()?.view ?? null;
  };

  // Keep only a reference to the main grid, like the shown `basis`; its source is read from the live state.
  // An open file may change the panel's basis, but focusing a sidebar does not change this grid.
  let lastGrid: BubaGridView | null = null;
  let sourceKey: string | null = null;
  const sourceListeners = new Set<() => void>();
  const currentTag = (): string | null => {
    const grids = assets.gridViews();
    const main = mainView();
    const grid = grids.find((each) => (each as unknown) === main);
    if (grid) lastGrid = grid;
    if (!lastGrid || !grids.includes(lastGrid)) return null;
    const source = normalizeGridViewState((lastGrid as unknown as View).getState()).source;
    return source?.kind === 'tag' && typeof source.tag === 'string' ? tagKey(source.tag) : null;
  };
  const sourceChanged = (): void => {
    const next = currentTag();
    if (next === sourceKey) return;
    sourceKey = next;
    for (const listener of [...sourceListeners]) listener();
  };

  // A file view is recognised by its file, without importing `FileView`: an Obsidian view with a file has a
  // `TFile` in `file`.
  const describe = (view: View | null): MainView<View> | null => {
    if (!view) return null;
    const grid = assets.gridViews().find((each) => (each as unknown) === view);
    if (grid) {
      let order: Set<string> | null = null;
      // The raw selection includes folders: from it the rule sees that something new was picked.
      const picked = grid.selectedPaths?.() ?? [];
      return {
        kind: 'grid',
        view,
        state: gridContentKey(view.getState()),
        selected: filesOf(picked),
        picked,
        shows: (path) => (order ??= new Set(grid.pathsInOrder())).has(path),
      };
    }
    const file: unknown = (view as View & { file?: unknown }).file;
    if (file instanceof TFile && !inDataDir(file.path)) return { kind: 'file', view, path: file.path };
    return { kind: 'other', view };
  };

  const loaded = (): InspectorView[] =>
    workspace
      .getLeavesOfType(INSPECTOR_VIEW_TYPE)
      .map((leaf) => leaf.view)
      .filter((view) => view instanceof InspectorView);

  // What is shown is taken from the open panel: it applies renames and deletions of shown files itself.
  const current = (): readonly string[] => loaded()[0]?.shownPaths() ?? shown.paths;

  /** Slide the panel out and show; used by selection on desktop and by the menu item. */
  const reveal = async (paths: readonly string[]): Promise<void> => {
    const leaf = await workspace.ensureSideLeaf(INSPECTOR_VIEW_TYPE, 'right', { reveal: true });
    await leaf.loadIfDeferred();
    if (leaf.view instanceof InspectorView) leaf.view.showFiles(paths);
  };

  /**
   * Phone: show in the panel without sliding it out. The right sidebar there is a drawer and would cover the
   * grid on every tap; the gesture, the "File panel" item and the command slide it out. Without a leaf one is
   * created collapsed; after a restart Obsidian keeps a collapsed leaf deferred, and it must be loaded before
   * it can show anything.
   */
  const quiet = async (paths: readonly string[]): Promise<void> => {
    const leaves = workspace.getLeavesOfType(INSPECTOR_VIEW_TYPE);
    if (!leaves.length)
      leaves.push(await workspace.ensureSideLeaf(INSPECTOR_VIEW_TYPE, 'right', { reveal: false }));
    for (const leaf of leaves) {
      await leaf.loadIfDeferred();
      if (leaf.view instanceof InspectorView) leaf.view.showFiles(paths);
    }
  };

  /** Open panels only: a closed one is not opened for this. */
  const openOnly = (paths: readonly string[]): void => {
    for (const view of loaded()) view.showFiles(paths);
  };

  // Causes run one at a time and only the latest counts: while the panel is opening, the next call must not
  // create a second one. The menu item always runs.
  let latest = 0;
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (job: () => Promise<void>, always = false): Promise<void> => {
    const mine = ++latest;
    queue = queue
      .then(() => (always || mine === latest ? job() : undefined))
      .catch((error: unknown) => console.error('Buba: file panel did not show the file', error));
    return queue;
  };

  const decide = (cause: Cause<View>): void => {
    sourceChanged();
    void enqueue(async () => {
      const before = current();
      const next = nextShown({ paths: before, basis: shown.basis }, describe(mainView()), cause);
      if (!next) return;
      shown = next;
      const { paths } = next;
      // A grid selection on desktop slides the panel out.
      if (cause.kind === 'select' && paths.length) return Platform.isMobile ? quiet(paths) : reveal(paths);
      if (samePaths(paths, before)) return;
      if (Platform.isMobile && paths.length) return quiet(paths);
      openOnly(paths);
    });
  };

  plugin.registerEvent(
    // Obsidian's types do not know our workspace events, so the workspace is used as `Events`.
    (workspace as Events).on(SELECTION_CHANGE, (view) => decide({ kind: 'select', from: view as View })),
  );
  // When the panel itself or a sidebar becomes active, what is shown stays.
  plugin.registerEvent(
    workspace.on('active-leaf-change', (leaf) => {
      if (leaf?.view.navigation) decide({ kind: 'activate' });
    }),
  );
  plugin.registerEvent(workspace.on('file-open', () => decide({ kind: 'activate' })));
  // Rename and move through Obsidian: the shown paths and the basis's raw selection move to the new name,
  // like the grid selection (src/assets/grid/selection.ts) and the panel view (view.ts). The selection
  // announces the new name in a frame while the basis moves at once, so listener order does not matter.
  // Without this a folder selected together with a removed file and then renamed counts as a new pick, and
  // the panel says "Select a file".
  plugin.registerEvent(
    vault.on('rename', (file, oldPath) => {
      shown = renamedShown(shown, oldPath, file.path);
    }),
  );
  // The grid set a new state (folder, source, back/forward step, view): like `file-open` for a file view,
  // what the main view shows has changed. Obsidian sends no `layout-change` here because the view is the
  // same. Another folder with an empty selection gives "Select a file"; a view change without a content
  // change keeps what is shown, since the key is the same.
  plugin.registerEvent((workspace as Events).on(GRID_STATE_CHANGE, () => decide({ kind: 'activate' })));
  // A press on empty grid space is the gesture that clears the grid selection (src/assets/grid/selection.ts):
  // with it the panel shows the grid selection even if the shown file left the grid. With Ctrl (Cmd) the
  // marquee adds to the selection without clearing it, so the panel stays too.
  onGridEvent(plugin, assets, 'mousedown', (evt, { view, path }) => {
    if (path === null && evt.button === 0 && !evt.ctrlKey && !evt.metaKey)
      decide({ kind: 'clear', from: view });
  });

  return {
    paths: () => shown.paths,
    currentTag,
    onSourceChange(listener) {
      sourceListeners.add(listener);
      return () => {
        sourceListeners.delete(listener);
      };
    },
    pick: (paths) =>
      enqueue(async () => {
        shown = picked(filesOf(paths), describe(mainView()));
        await reveal(shown.paths);
      }, true),
  };
}
