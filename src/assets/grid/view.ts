// The grid view in the center. Its state is a GridViewState in the leaf state: Obsidian calls setState after
// every leaf open, with the state saved in the layout or with {}. Only setState, setGridState, refresh,
// connection registry changes and file index and source changes redraw the grid. The look (sort, direction,
// layout, fit, size, names) comes from the place the grid shows: the place's own view on this device,
// otherwise the common one (memory in place-views.ts).
import {
  ItemView,
  Keymap,
  Platform,
  Scope,
  TFolder,
  type KeymapEventHandler,
  type KeymapEventListener,
  type Menu,
  type Modifier,
  type Plugin,
  type TAbstractFile,
  type ViewStateResult,
  type WorkspaceLeaf,
} from 'obsidian';
import { GRID_MENU, GRID_STATE_CHANGE, SELECTION_RESTORE } from '../../core/layout/grid-events.ts';
import {
  followRenames,
  GRID_VIEW_TYPE,
  nextGridState,
  normalizeGridViewState,
  renameGridFolder,
  type GridViewState,
} from '../../core/layout/view-state.ts';
import {
  countTypes,
  filterByType,
  newlyHidden,
  typesKey,
  type TypeShown,
} from '../../core/filter/file-types.ts';
import { lookOf, sameLook } from '../../core/layout/place-views.ts';
import type { CoverFrame, FolderLooks } from '../../core/storage/types.ts';
import { coverInFront, type BubaSettings } from '../../core/settings/settings.ts';
import { gridItems, keepsPlace, type GridItem } from '../../core/sort/grid-items.ts';
import { BATCH_FRAME_MS, batchRunning, onBatchEnd } from '../../platform/files/batch.ts';
import { pathsVersionOf, type FileIndex, type FileRecord } from '../../platform/files/file-index.ts';
import { vaultFileIndex } from '../../platform/files/vault-index.ts';
import { onSettingsChange, settingsOf } from '../../platform/settings.ts';
import type { BubaAssets, BubaGridView, FolderSource, GridSourceProvider } from '../api.ts';
import { seriesTile } from './click-series.ts';
import { FolderFaces, isCoverFile } from './folder-faces.ts';
import { isNavigationStep } from './navigation.ts';
import { placeKeyOf, placeViewsOf, shownSource, type PlaceMemory, type Shown } from './place-views.ts';
import { TileGrid, type TilePlace, type TileRect } from './tiles.ts';
import { lookMenu, paneMenu, renderToolbar, type LookControls, type ToolbarContext } from './toolbar.ts';
import './grid.css';

// The view type lives in the core: the commands module takes it from there, `src/assets/index.ts` from here.
export { GRID_VIEW_TYPE };

type Renames = readonly (readonly [string, string])[];
const folderRenames = new WeakMap<Plugin, Renames>();

/**
 * "File type": checked types are remembered per tab, that is per leaf, not per view. A double click on a note
 * or PDF opens it in the same tab, Obsidian closes the grid view, and "Back" builds a new one on the same
 * leaf, so a choice kept on the view was lost. Not in `getState` or the ephemeral state: Obsidian writes
 * those to the layout and history, and the choice would survive a restart; after a restart leaves are new and
 * have no choice. A new tab is a new leaf without a filter; a closed leaf leaves the memory with its choice.
 */
interface TypeMemory {
  types: ReadonlySet<string>;
  keep: boolean;
  place: string | null;
}
const typesByLeaf = new WeakMap<WorkspaceLeaf, TypeMemory>();

/** A place from the ephemeral state: a path and a numeric offset; anything else is not a place. */
function placeOf(value: unknown): TilePlace | null {
  if (typeof value !== 'object' || value === null) return null;
  const { path, offset } = value as Record<string, unknown>;
  return typeof path === 'string' && typeof offset === 'number' && Number.isFinite(offset)
    ? { path, offset }
    : null;
}

/**
 * Folder renames `[from, to]` in order, one list per plugin, tracked from module load
 * (`registerGridSources`): a tab back/forward step carries the folder under its old name, and Obsidian does
 * not write tab history to the layout. Not on the view: a tab that moved from the grid to a note builds a new
 * view on "Back", and after a restart Obsidian does not build a tab behind the active one until it is first
 * shown (`leaf.isDeferred`); renames made meanwhile must not be lost.
 */
export function renamesOf(plugin: Plugin): Renames {
  const known = folderRenames.get(plugin);
  if (known) return known;
  const renames: [string, string][] = [];
  folderRenames.set(plugin, renames);
  plugin.registerEvent(
    plugin.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFolder) renames.push([oldPath, file.path]);
    }),
  );
  return renames;
}

/**
 * The view's `scope`: other modules' keys work only while focus is in the grid body. Obsidian 1.13 hands keys
 * to the active leaf's `scope` wherever focus is (the workspace key scope calls `activeLeaf.view.scope`), so
 * this scope has no keys of its own: registrations go to `body`, which `app.keymap.pushScope` installs while
 * focus is in the body. Without focus a key goes to `app.scope`, as for a view without keys.
 */
class BodyScope extends Scope {
  readonly body: Scope;

  constructor(parent: Scope) {
    super(parent);
    this.body = new Scope(parent);
  }

  override register(
    modifiers: Modifier[] | null,
    key: string | null,
    func: KeymapEventListener,
  ): KeymapEventHandler {
    return this.body.register(modifiers, key, func);
  }

  override unregister(handler: KeymapEventHandler): void {
    this.body.unregister(handler);
  }
}

export class GridView extends ItemView implements BubaGridView {
  readonly #plugin: Plugin;
  readonly #assets: BubaAssets;
  readonly #index: FileIndex;
  readonly #renames: Renames;
  readonly #views: PlaceMemory;
  #state = normalizeGridViewState(undefined);
  #toolbar: HTMLElement | null = null;
  /**
   * What the toolbar showed last draw: the title, the filter result and "place has its own view" (the reset
   * badge).
   */
  #bar: { title: string | null; tally: { shown: number; total: number } | null; own: boolean } = {
    title: null,
    tally: null,
    own: false,
  };
  #tiles: TileGrid | null = null;
  #faces: FolderFaces | null = null;
  /** The grid body and its empty hint: the `pane-empty` element and its lines joined into one string. */
  #body: HTMLElement | null = null;
  #hint: HTMLElement | null = null;
  #hintText = '';
  readonly #tileMarks = new Map<string, (path: string) => string[]>();
  /** Index records by path; `null` means rebuild: the index changed. */
  #records: Map<string, FileRecord> | null = null;
  /** Index path set version at which `#records` was built. */
  #recordsVersion: number | null = null;
  /**
   * `#records` has entries older than the index (an edit of the same path after the build): the full path
   * rebuilds them.
   */
  #recordsDirty = false;
  /**
   * What waits for the frame: nothing; only content edits of known paths, which the frame tries to apply in
   * place (`#patch`); anything else takes the full path. Only the redraw itself clears `'full'` before the
   * frame.
   */
  #edit: 'none' | 'edits' | 'full' = 'full';
  /**
   * Index edit notifications before the frame: more than the records that changed means a path was edited
   * twice, so take the full path.
   */
  #pendingEdits = 0;
  /** The last tile display: which tiles got what; the tile index by path is built from it on demand. */
  #last: { tiles: TileGrid; items: GridItem<FileRecord>[]; at: Map<string, number> | null } | null = null;
  #provider: GridSourceProvider | undefined;
  #offProvider: (() => void) | null = null;
  /** What is shown, so a new source opens from the top while the same one stays in place. */
  #shownSource = '';
  #frame = 0;
  /** A redraw waiting for the calm pace of a running batch (`#schedule`). */
  #paced = 0;
  /**
   * History steps run one at a time: Obsidian silently drops a second `setViewState` on a leaf while the
   * first runs.
   */
  #steps: Promise<void> = Promise.resolve();
  /** A `setViewState` of the same state, only for Obsidian to redraw the tab title (`#retab`). */
  #retabbing = false;
  /**
   * "File type": checked types, empty means all. Remembered per tab (`typesByLeaf`): a new view on the same
   * leaf takes the choice from there; changing place clears it unless keeping is on; a new tab has no filter.
   */
  #types: ReadonlySet<string>;
  #keepTypes = false;
  #typePlace: string | null = null;
  /** What the filter showed last draw, to spot new files it hid. */
  #typeShown: TypeShown | null = null;
  readonly #keys = new BodyScope(this.app.scope);

  // The grid is navigated like notes: Obsidian keeps its tab history (the tab back and forward arrows), and
  // `getLeaf(false)` with an active grid returns its leaf, as for a note, PDF or canvas.
  override navigation = true;

  // In Obsidian 1.13 a view has no `scope` at all (undefined), although the types promise `null`.
  override scope: Scope | null = this.#keys;

  /** Set by the selection module. */
  declare selectedPaths?: () => string[];
  /** Shift anchor tile, set by the selection module. */
  declare selectionAnchor?: () => string | null;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin, assets: BubaAssets) {
    super(leaf);
    this.#plugin = plugin;
    this.#assets = assets;
    this.#index = vaultFileIndex(plugin);
    this.#renames = renamesOf(plugin);
    this.#views = placeViewsOf(plugin, assets);
    const memory = typesByLeaf.get(leaf);
    this.#types = memory?.types ?? new Set();
    this.#keepTypes = memory?.keep ?? false;
    this.#typePlace = memory?.place ?? null;
  }

  override getViewType(): string {
    return GRID_VIEW_TYPE;
  }

  /**
   * The tab's title is what it shows, as a note's tab carries the note's name (word of the owner 28.10 17:25):
   * the folder, "All files", the tag, "Bookmarks", by the same title as the path above the grid. Obsidian
   * redraws the tab header after `setViewState`, and every place change goes through it (`setState` below).
   */
  override getDisplayText(): string {
    const { source, provider } = this.#source();
    const title = provider?.title(source);
    if (title) return title;
    return 'Buba';
  }

  override getIcon(): string {
    return 'bird';
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass('buba-grid');
    this.#toolbar = this.contentEl.createDiv({ cls: 'buba-grid-toolbar' });
    const body = this.contentEl.createDiv({ cls: 'buba-grid-scroller', attr: { tabindex: '0' } });
    this.#tiles = new TileGrid(body, this.#plugin);
    this.#body = body;
    // Folder tiles look like their tree rows and show a cover or the first picture (folder-faces.ts). Index
    // changes redraw the grid anyway, so they only drop the faces (the index listener below).
    const storage = (this.#plugin as Plugin & { storage?: FolderLooks }).storage;
    const faces = new FolderFaces(
      this.app.vault,
      this.#index,
      storage,
      () => settingsOf(this.#plugin).folderAutoCover,
      () => settingsOf(this.#plugin).folderTile === 'one',
    );
    this.#faces = faces;
    this.#tiles.setFolderFaces((path) => faces.face(path));
    const refaced = (): void => {
      faces.clear();
      this.#tiles?.refreshFolders();
    };
    if (storage) this.register(storage.onFolderLook(refaced));
    // "Program file tiles" changes the proportion of files without a picture in rows and columns.
    let fileTile = settingsOf(this.#plugin).fileTile;
    this.register(
      onSettingsChange(this.#plugin, (settings) => {
        if (settings.fileTile === fileTile) return;
        fileTile = settings.fileTile;
        this.#tiles?.restyle();
      }),
    );
    // A back plate in the cover's color is counted only under its settings: they turn it on for shown folders.
    const plateOf = (settings: BubaSettings): string => `${coverInFront(settings)}|${settings.folderPlate}`;
    let plate = plateOf(settingsOf(this.#plugin));
    this.register(
      onSettingsChange(this.#plugin, (settings) => {
        const next = plateOf(settings);
        if (next === plate) return;
        plate = next;
        this.#tiles?.recolor();
      }),
    );
    // "Cover from contents" and "One picture, the cover" change which folders show a picture.
    const facesOf = (settings: BubaSettings): string =>
      `${settings.folderAutoCover}|${settings.folderTile === 'one'}`;
    let shown = facesOf(settingsOf(this.#plugin));
    this.register(
      onSettingsChange(this.#plugin, (settings) => {
        const next = facesOf(settings);
        if (next === shown) return;
        shown = next;
        refaced();
      }),
    );
    const cover = (file: TAbstractFile): void => {
      if (isCoverFile(file)) refaced();
    };
    this.registerEvent(this.app.vault.on('create', cover));
    this.registerEvent(this.app.vault.on('delete', cover));
    for (const [key, marks] of this.#tileMarks) this.#tiles.setMarks(marks, key);
    const { keymap } = this.app;
    this.registerDomEvent(body, 'focusin', () => keymap.pushScope(this.#keys.body));
    this.registerDomEvent(body, 'focusout', () => keymap.popScope(this.#keys.body));
    this.registerDomEvent(body, 'dblclick', (evt) => this.#openFolder(body, evt));
    // The middle button opens a folder tile in a new tab, as Obsidian's file explorer; file tiles: viewer/open.ts.
    // The press is cancelled, or Windows starts middle-button autoscroll and no `auxclick` follows.
    this.registerDomEvent(body, 'mousedown', (evt) => {
      if (evt.button === 1 && this.#folderAt(evt) !== null) evt.preventDefault();
    });
    this.registerDomEvent(body, 'auxclick', (evt) => {
      const path = evt.button === 1 ? this.#folderAt(evt) : null;
      if (path === null) return;
      evt.preventDefault();
      void this.#assets.openGrid(folderSource(path), true);
    });
    // The registry changed: the grid may now show another place, a module source instead of a folder or back.
    this.register(this.#assets.onChange(() => this.#replace(true)));
    this.register(this.#views.onChange(() => this.#replace(false)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.#renamed(file, oldPath)));
    // A batch is over: what waited for its pace is drawn now.
    this.register(
      onBatchEnd(() => {
        if (!this.#paced) return;
        window.clearTimeout(this.#paced);
        this.#paced = 0;
        this.#schedule();
      }),
    );
    this.register(
      this.#index.onChange(() => {
        this.#faces?.clear();
        // Same path set means a content edit (a note autosave): records are kept and the frame tries to keep
        // the order; a new path set (added, deleted, moved, filled) takes the full path.
        const version = pathsVersionOf(this.#index);
        if (this.#records && version !== null && version === this.#recordsVersion && this.#edit !== 'full') {
          this.#edit = 'edits';
          this.#recordsDirty = true;
          this.#pendingEdits += 1;
        } else {
          this.#records = null;
          this.#edit = 'full';
        }
        this.#schedule();
      }),
    );
  }

  override async onClose(): Promise<void> {
    this.app.keymap.popScope(this.#keys.body);
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    window.clearTimeout(this.#paced);
    this.#paced = 0;
    this.#offProvider?.();
    this.#offProvider = null;
    this.#provider = undefined;
    this.#tiles?.destroy();
    this.#tiles = null;
    this.#showHint([]);
    this.#body = null;
  }

  /**
   * The header's "More" (⋮) menu: on a phone Obsidian keeps view actions there, and only the path stays above
   * the grid, so the toolbar toggles move here and other modules add items through the `buba:grid-menu`
   * event. On desktop and phone a place with its own view gets "Reset to common view" and "Make this view
   * common", on a phone under a "Folder view" header like the other Buba sections. The tab menu
   * (`tab-header`) gets no items of ours.
   */
  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    if (source !== 'more-options') return;
    if (Platform.isPhone) {
      this.app.workspace.trigger(GRID_MENU, menu, this);
      const { source: shown, provider, foreign } = this.#source();
      const title = foreign && provider ? provider.title(shown) : null;
      paneMenu(
        menu,
        this.app,
        this.#state,
        (patch) => this.setGridState(patch),
        this.#context(title, null, 0),
        false,
        true,
      );
    }
    lookMenu(menu, this.#look(), true, Platform.isPhone);
  }

  override getState(): Record<string, unknown> {
    return { ...this.#state };
  }

  /**
   * What is shown changed: a tab history step, which Obsidian records from `result.history`. Everything that
   * sets a place goes through here: the tree, the path above the grid, a folder tile, `openGrid`,
   * `buba:open`, the layout, back and forward, a new tab.
   */
  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (this.#retabbing) return super.setState(state, result);
    this.#views.arrived(state);
    const next = this.#placed(this.#followed(normalizeGridViewState(state)));
    if (isNavigationStep(this.#state, next)) result.history = true;
    this.#apply(next);
    await super.setState(state, result);
  }

  /**
   * Scroll place, selection and its anchor are the view's ephemeral state, like a note's scroll and cursor:
   * Obsidian puts it into the tab history step (`getHistoryState`) and gives it back on back and forward. A
   * hidden body returns the place it showed (`TileGrid.place`), as a note view returns its remembered scroll.
   */
  override getEphemeralState(): Record<string, unknown> {
    const state: Record<string, unknown> = {};
    const place = this.#tiles?.place();
    if (place) state.place = place;
    const selected = this.selectedPaths?.();
    if (selected) state.selected = selected;
    const anchor = this.selectionAnchor?.();
    if (typeof anchor === 'string') state.anchor = anchor;
    return state;
  }

  /**
   * Back or forward step: Obsidian sets the state (`setState`), then the ephemeral state, on the same view or
   * a new one if a note occupied the tab. The grid sets the tile place once it has laid out this content; the
   * selection module sets the selection and anchor (a step saved by an older version has no anchor: `null`).
   * Other ephemeral state, such as `{ focus: true }` of the active leaf, leaves place and selection alone.
   */
  override setEphemeralState(state: unknown): void {
    super.setEphemeralState(state);
    if (typeof state !== 'object' || state === null) return;
    const { place, selected, anchor } = state as Record<string, unknown>;
    const at = placeOf(place);
    if (at) this.#tiles?.setPlace(at);
    if (Array.isArray(selected)) {
      const paths = selected.filter((path): path is string => typeof path === 'string');
      const from = typeof anchor === 'string' ? anchor : null;
      this.app.workspace.trigger(SELECTION_RESTORE, this, paths, from);
    }
  }

  /**
   * Changes part of the state, as the toolbar and the console do; moving to a folder clears `source`. A
   * history step goes through the leaf: Obsidian records a step only when `setViewState` sets the state. A
   * look change applies at once and the place remembers it. The view first, then the memory: a subscriber on
   * this same view already sees the new look and does not re-lay out the tiles a second time, so the slider
   * keeps the tile at the top.
   */
  setGridState(patch: Partial<GridViewState>): void {
    const next = nextGridState(this.#state, patch);
    if (!isNavigationStep(this.#state, next)) {
      this.#apply(next);
      this.#views.remember(placeKeyOf(next, this.#assets), lookOf(next));
      return;
    }
    const step = async (): Promise<void> => {
      if (this.leaf.view !== this) return;
      const state = { ...nextGridState(this.#state, patch) };
      await this.leaf.setViewState({ type: GRID_VIEW_TYPE, state });
    };
    this.#steps = this.#steps.then(step, step);
  }

  pathsInOrder(): string[] {
    return this.#tiles?.pathsInOrder() ?? [];
  }

  frameCover(path: string, done: (frame: CoverFrame | null) => void): boolean {
    return this.#tiles?.frameCover(path, done) ?? false;
  }

  tileRects(): TileRect[] {
    return this.#tiles?.tileRects() ?? [];
  }

  setTileMarks(fn: ((path: string) => string[]) | null, key = 'selection'): void {
    if (fn) this.#tileMarks.set(key, fn);
    else this.#tileMarks.delete(key);
    this.#tiles?.setMarks(fn, key);
  }

  reveal(path: string): void {
    this.#tiles?.reveal(path);
  }

  // In the next frame, like index changes: "By rating" calls this on every storage notification.
  refresh(): void {
    this.#edit = 'full';
    this.#schedule();
  }

  /**
   * A double click on a folder tile opens it in this grid, as in Obsidian's file explorer and in Eagle: with
   * the same `{ folder }` patch as the path above the grid and the Buba tree, a tab history step; a module
   * source is cleared and the look stays. On a phone a tap sends the tile the same `dblclick`
   * (src/assets/mobile/index.ts). A file tile is opened by the viewer (src/assets/viewer/open.ts), a single
   * click selects (selection.ts). The folder is the tile of the series' first press, as for them
   * (click-series.ts): the first click on a file slid out the panel, the grid re-laid out and the second
   * click landed on a folder tile; that is a double click on the file, not navigation.
   */
  #openFolder(body: HTMLElement, evt: MouseEvent): void {
    const el = evt.target as Element | null;
    if (evt.button !== 0 || typeof el?.closest !== 'function') return;
    const first = seriesTile(body, evt);
    const path = first === undefined ? el.closest<HTMLElement>('.buba-tile[data-path]')?.dataset.path : first;
    if (!path || !this.app.vault.getFolderByPath(path)) return;
    // With Ctrl (Cmd) in a new tab, with Ctrl+Alt to the right, as Obsidian's file explorer.
    const pane = Keymap.isModEvent(evt);
    if (pane) void this.#assets.openGrid(folderSource(path), pane);
    else this.setGridState({ folder: path });
  }

  /** The folder of the tile under a press, or `null`. */
  #folderAt(evt: MouseEvent): string | null {
    const el = evt.target as Element | null;
    const path =
      typeof el?.closest === 'function'
        ? el.closest<HTMLElement>('.buba-tile[data-path]')?.dataset.path
        : undefined;
    return path && this.app.vault.getFolderByPath(path) ? path : null;
  }

  /** The state with the look of the place it shows; the same state if the look is unchanged or unknown. */
  #placed(state: GridViewState): GridViewState {
    const look = this.#views.lookFor(placeKeyOf(state, this.#assets));
    return look === null || sameLook(look, state) ? state : { ...state, ...look };
  }

  /**
   * The memory or a registry changed: if the place's look differs, apply it without a history step (a look
   * from another tab, the common view, "Reset to common view"); if it is the same, redraw for the registry,
   * or only the toolbar if the place gained or lost its own view.
   */
  #replace(render: boolean): void {
    const next = this.#placed(this.#state);
    if (next !== this.#state) this.#apply(next);
    else if (render) this.#render();
    else if (this.#views.differs(lookOf(this.#state)) !== this.#bar.own) this.#renderBar(0);
  }

  /** "Reset to common view" and "Make this view common" for the place the grid shows. */
  #look(): LookControls {
    return {
      own: this.#views.differs(lookOf(this.#state)),
      reset: () => {
        this.#views.forget(placeKeyOf(this.#state, this.#assets));
        this.#replace(false);
      },
      makeCommon: () => this.#views.makeCommon(placeKeyOf(this.#state, this.#assets), lookOf(this.#state)),
    };
  }

  /**
   * A tab history step carries the folder under its name back then; if it no longer exists, use its current
   * name.
   */
  #followed(state: GridViewState): GridViewState {
    const isFolder = (path: string) => this.app.vault.getAbstractFileByPath(path) instanceof TFolder;
    const folder = followRenames(state.folder, this.#renames, isFolder);
    return folder === state.folder ? state : { ...state, folder };
  }

  /**
   * The open folder follows a rename of itself or a folder above, like a file tab (`FileView.onRename`): no
   * history step and no scroll to top, since the source is the same. Tiles update in the next frame: by then
   * the index has applied the rename, and it may have subscribed later than the view.
   */
  #renamed(file: TAbstractFile, oldPath: string): void {
    if (!(file instanceof TFolder)) return;
    const next = renameGridFolder(this.#state, oldPath, file.path);
    if (next === this.#state) return;
    this.#state = next;
    this.#typePlace = placeKeyOf(next, this.#assets);
    this.#rememberTypes();
    this.#shownSource = JSON.stringify(this.#source().source);
    this.#schedule();
    this.#retitle();
    this.#retab();
    this.app.workspace.requestSaveLayout();
  }

  /**
   * The tab title: Obsidian redraws it only on `setViewState`. The same state again, which the view lets
   * through untouched: no history step, no redraw, no "state changed".
   */
  #retab(): void {
    const step = async (): Promise<void> => {
      if (this.leaf.view !== this) return;
      this.#retabbing = true;
      try {
        await this.leaf.setViewState({ type: GRID_VIEW_TYPE, state: this.getState() });
      } finally {
        this.#retabbing = false;
      }
    };
    this.#steps = this.#steps.then(step, step);
  }

  /**
   * The title in the view header, next to back and forward, is what the tab title says. Obsidian sets it once
   * when the view opens: a file view renews it on load and rename, a view of its own does it itself.
   */
  #retitle(): void {
    this.containerEl.querySelector<HTMLElement>('.view-header-title')?.setText(this.getDisplayText());
  }

  /**
   * Applies a state: from `setState` (history step, `openGrid`, layout) and from `setGridState` without a
   * step (look, sort, size). A setViewState on a leaf of the same type does not save the layout, and without
   * saving a restart would reopen the previous folder. Then the "state changed" event: Obsidian sends no
   * `layout-change` here because the view is the same; it fires after the redraw, so a subscriber already
   * sees the new content.
   */
  #apply(state: GridViewState): void {
    const place = placeKeyOf(state, this.#assets);
    if (this.#typePlace !== null && this.#typePlace !== place && !this.#keepTypes) this.#types = new Set();
    this.#typePlace = place;
    this.#rememberTypes();
    this.#state = state;
    this.#render();
    this.#retitle();
    this.app.workspace.requestSaveLayout();
    this.app.workspace.trigger(GRID_STATE_CHANGE, this);
  }

  /**
   * Index and source changes are batched into one redraw per frame; while a batch of moves runs, into one
   * redraw per `BATCH_FRAME_MS` (src/platform/files/batch.ts).
   */
  #schedule(): void {
    if (this.#frame || this.#paced || !this.#tiles) return;
    if (batchRunning()) {
      this.#paced = window.setTimeout(() => {
        this.#paced = 0;
        this.#render(true);
      }, BATCH_FRAME_MS);
      return;
    }
    this.#frame = window.requestAnimationFrame(() => {
      this.#frame = 0;
      this.#render(true);
    });
  }

  /**
   * A module source uses its provider; without a registered kind or a source, the folder from `folder` and
   * `deep`.
   */
  #source(): Shown {
    return shownSource(this.#state, this.#assets);
  }

  /** Records as of the read: the full path and the types window never use a stale snapshot from edit time. */
  #recordsByPath(): ReadonlyMap<string, FileRecord> {
    if (!this.#records || this.#recordsDirty) {
      this.#records = new Map();
      this.#recordsDirty = false;
      this.#recordsVersion = pathsVersionOf(this.#index);
      for (const record of this.#index.allFiles()) this.#records.set(record.path, record);
    }
    return this.#records;
  }

  /**
   * What the toolbar knows about the view: a module source's title and "File type" (the choice, the filter
   * result, `null` without a filter, new hidden files since the last draw). Type counts for the window are
   * one pass over the place, done when the window opens.
   */
  #context(
    title: string | null,
    tally: { shown: number; total: number } | null,
    hiddenNew: number,
  ): ToolbarContext {
    return {
      app: this.app,
      assets: this.#assets,
      sourceTitle: () => title,
      types: {
        selected: this.#types,
        keep: this.#keepTypes,
        setKeep: (keep) => {
          this.#keepTypes = keep;
          this.#rememberTypes();
        },
        tally,
        hiddenNew,
        counts: () => {
          const { source, provider } = this.#source();
          return countTypes(provider?.paths(source) ?? [], this.#recordsByPath(), this.#types);
        },
        set: (types) => this.#setTypes(types),
      },
      look: this.#look(),
    };
  }

  /**
   * A new type choice goes to the tab memory; the grid starts from the top like a new place; no layout save,
   * since the choice is not in it.
   */
  #setTypes(types: ReadonlySet<string>): void {
    this.#types = new Set(types);
    this.#rememberTypes();
    this.#shownSource = '';
    this.#render();
  }

  #rememberTypes(): void {
    typesByLeaf.set(this.leaf, { types: this.#types, keep: this.#keepTypes, place: this.#typePlace });
  }

  /** Toolbar for the current state; `hiddenNew` is new files the filter hid since the last body draw. */
  #renderBar(hiddenNew: number): void {
    if (!this.#toolbar) return;
    const ctx = this.#context(this.#bar.title, this.#bar.tally, hiddenNew);
    this.#bar.own = ctx.look?.own ?? false;
    renderToolbar(this.#toolbar, this.#state, (patch) => this.setGridState(patch), ctx);
  }

  /**
   * `fromFrame` is the `#schedule` frame: if only content edits are waiting, try `#patch` first. A direct
   * call (a state, filter or registry change) cancels the scheduled frame and takes the full path, which
   * includes the waiting edits.
   */
  #render(fromFrame = false): void {
    if (!this.#toolbar || !this.#tiles) return;
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    window.clearTimeout(this.#paced);
    this.#paced = 0;
    const edits = fromFrame && this.#edit === 'edits' ? this.#pendingEdits : 0;
    this.#edit = 'none';
    this.#pendingEdits = 0;
    if (edits > 0 && this.#patch(edits)) return;
    const { source, provider, foreign } = this.#source();
    if (provider !== this.#provider) {
      this.#offProvider?.();
      this.#offProvider = provider
        ? provider.onChange(() => {
            // Inside an index notification this is an echo of the same edit ("folder" and "All files"
            // subscribe to the same index), already handled by the index subscriber. Outside, it is a module
            // source signal (a tag set or removed): take the full path.
            if (!this.#index.notifying()) this.#edit = 'full';
            this.#schedule();
          })
        : null;
      this.#provider = provider;
    }
    const title = foreign && provider ? provider.title(source) : null;
    const shown = JSON.stringify(source);
    const records = this.#recordsByPath();
    let paths = provider?.paths(source) ?? [];
    let tally: { shown: number; total: number } | null = null;
    let hiddenNew = 0;
    // Without a filter the usual path; with a filter one selection pass before sorting.
    if (this.#types.size > 0) {
      const kept = filterByType(paths, records, this.#types);
      const now = { place: shown, types: typesKey(this.#types), shown: kept.paths.length, total: kept.total };
      hiddenNew = newlyHidden(this.#typeShown, now);
      this.#typeShown = now;
      tally = { shown: now.shown, total: now.total };
      paths = kept.paths;
    } else this.#typeShown = null;
    this.#bar.title = title;
    this.#bar.tally = tally;
    this.#renderBar(hiddenNew);
    const { folder } = this.#state;
    const subfolders = foreign
      ? (provider?.folders?.(source) ?? [])
      : folder !== null
        ? this.#index.subfolders(folder)
        : [];
    const sortKey = this.#assets.sortKeys().find((key) => key.id === this.#state.sort);
    // "Then by": a key missing from the registry, or "None", means no second level.
    const thenKey = this.#assets.sortKeys().find((key) => key.id === this.#state.thenSort);
    const then = thenKey && { compare: thenKey.compare, dir: this.#state.thenDir };
    const items = gridItems(paths, records, subfolders, sortKey?.compare, this.#state.dir, then);
    this.#tiles.update(items, this.#state, shown !== this.#shownSource);
    this.#shownSource = shown;
    this.#last = { tiles: this.#tiles, items, at: null };
    // The empty hint shows once emptiness is known: the index is filled (before `onLayoutReady` it is empty
    // and still full), there are no tiles (no files, no subfolders) and the filter hid nothing; if it hid
    // everything, the toolbar shows the filter result.
    const empty = this.#index.filled() && items.length === 0 && (tally === null || tally.total === 0);
    this.#showHint(empty ? (provider?.empty?.(source) ?? []) : []);
  }

  /**
   * Content edits of already shown paths, without sorting or layout: records are reconciled with the index as
   * of the frame; edited shown items all go into a new copy of the last display, then each is checked against
   * its neighbours in it (`keepsPlace`, the `gridItems` rule); if all stay in place, the tiles get the same
   * paths in the same order with new records. No edited shown items means the tiles are not called. If any
   * moves, or there are more notifications than changed records (a path edited twice, records already re-read
   * outside the frame), returns `false`: take the full path. The toolbar and hint stay: membership, filter
   * result and emptiness do not change with a content edit.
   */
  #patch(edits: number): boolean {
    const last = this.#last;
    const records = this.#records;
    if (!last || last.tiles !== this.#tiles || !records) return false;
    const changed: FileRecord[] = [];
    for (const record of this.#index.allFiles())
      if (records.get(record.path) !== record) {
        records.set(record.path, record);
        changed.push(record);
      }
    this.#recordsDirty = false;
    if (edits > changed.length) return false;
    const { items } = last;
    const at = (last.at ??= new Map(items.map((item, i) => [item.path, i])));
    let next: GridItem<FileRecord>[] | null = null;
    const moved: number[] = [];
    for (const record of changed) {
      const i = at.get(record.path);
      if (i === undefined) continue;
      (next ??= items.slice())[i] = { kind: 'file', path: record.path, file: record };
      moved.push(i);
    }
    if (!next) return true;
    const sortKey = this.#assets.sortKeys().find((key) => key.id === this.#state.sort);
    // "Then by": a key missing from the registry, or "None", means no second level.
    const thenKey = this.#assets.sortKeys().find((key) => key.id === this.#state.thenSort);
    const then = thenKey && { compare: thenKey.compare, dir: this.#state.thenDir };
    for (const i of moved) {
      const item = next[i]!;
      if (item.kind !== 'file' || !keepsPlace(next, i, item.file, sortKey?.compare, this.#state.dir, then))
        return false;
    }
    last.tiles.update(next, this.#state, false);
    this.#last = { tiles: last.tiles, items: next, at };
    return true;
  }

  /**
   * Hint lines are one `pane-empty` element with a child per line, like Obsidian's empty panes (bookmarks,
   * tags), in the body after the tiles: drop and paste are caught on the body, and the drop highlight is an
   * overlay on it (grid.css). The same lines keep the element; no lines remove it.
   */
  #showHint(lines: readonly string[]): void {
    const text = lines.join('\n');
    if (text === this.#hintText) return;
    this.#hintText = text;
    this.#hint?.detach();
    this.#hint = null;
    if (!lines.length || !this.#body) return;
    const hint = this.#body.createDiv({ cls: 'pane-empty' });
    for (const line of lines) hint.createDiv({ text: line });
    this.#hint = hint;
  }
}

/** The folder `path` alone, without subfolders, as a source to open in another tab. */
function folderSource(path: string): FolderSource {
  return { kind: 'folder', path, withSubfolders: false };
}
