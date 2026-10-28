// Connection point of modules to the grid and the tree: registries of grid sources, tree items and sort keys,
// plus access to open grid views. src/assets/index.ts creates the object and passes it to each module's
// `register…(plugin, assets)`. No `obsidian` at runtime: the registries are tested with a fake host.
import type { Menu, PaneType, Scope } from 'obsidian';
import type { CoverFrame } from '../core/storage/types.ts';
import type { FileRecord } from '../platform/files/file-index.ts';

export interface FolderSource {
  kind: 'folder';
  /** Folder path from the vault root; the root is `'/'`. */
  path: string;
  withSubfolders: boolean;
}

export interface AllFilesSource {
  kind: 'all';
}

/** A source kind registered by another module (`tag`, `untagged`): plain data, stored in the leaf state. */
export interface ModuleSource {
  kind: string;
  [key: string]: unknown;
}

/** What the grid shows. */
export type GridSource = FolderSource | AllFilesSource | ModuleSource;

/** Result of the "accept added" step (`acceptAdded`): tag `tag` was set; with `error` it was not, and why. */
export type AddedTag = { tag: string; error?: string };

export interface GridSourceProvider {
  /** Title for the path above the grid. */
  title(source: GridSource): string;
  /** File paths in any order: the grid sorts them and takes the records from the index. */
  paths(source: GridSource): readonly string[];
  /** Optional folder paths, shown as folder tiles before the files, as subfolders in a folder. */
  folders?(source: GridSource): readonly string[];
  /** "Content changed" signal; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  /**
   * Optional "accept added files" step: `paths` are the files that the add icon and "Add files" items, a drop
   * or a paste have just written in full while this source is open in the grid. The actions module calls it
   * once per batch. The result is data, not text (the added notice is one phrase of the actions dictionary
   * with substitutions): `{ tag }` means the tag was set, `{ tag, error }` that it was not, `error` being the
   * reason in the Buba language; `null` means nothing to say. A tag source tags the files with itself;
   * without the step the files are just added.
   */
  acceptAdded?: (source: GridSource, paths: readonly string[]) => Promise<AddedTag | null>;
  /**
   * Optional hint lines for an empty source: the grid shows them in Obsidian's grey `pane-empty` class, like
   * Obsidian's own empty panes, when the file index is filled, there are no tiles and the type filter hid
   * nothing. An empty list or no step leaves the area empty. A folder says "Folder is empty", a tag "No files
   * with this tag".
   */
  empty?(source: GridSource): readonly string[];
}

export interface TreeItem {
  id: string;
  title: string;
  icon?: string;
  /** Icon while the item is expanded; `icon` while it is collapsed. */
  openIcon?: string;
  /** Without it a click on the item only expands it. */
  source?: GridSource;
  /** Re-read on the item's signal. */
  count?: () => number;
  onChange?(listener: () => void): () => void;
  /** Draws the item's expandable content below it; the returned function removes what was drawn. */
  render?(containerEl: HTMLElement): void | (() => void);
  /**
   * Adds items to the tree item's menu (right click, or long press on a phone); if nothing is added, no menu
   * is shown.
   */
  menu?(menu: Menu): void;
  /** Takes drops on the item's row. */
  drop?: TreeItemDrop;
  /**
   * Place among the items, top first: "Bookmarks" 10, the databases section 20; without it 50, where "All
   * files", "Untagged" and "All tags" stand. Equal places keep the registration order; folders are below all.
   */
  order?: number;
  /** Buttons on the item's row before its count, such as a section's "+". */
  actions?: readonly TreeItemAction[];
}

/** A button on a tree item's row: an icon with a tooltip; a press runs it and neither opens nor expands the row. */
export interface TreeItemAction {
  icon: string;
  title: string;
  run(evt: MouseEvent): void;
}

/**
 * A button of the tree's header, between "New folder" and "Sort order", for an action on the whole tree such as
 * "New tag" (word of the owner 27.10 22:22: like Obsidian's file explorer header, on a phone and a computer).
 */
export interface TreeHeaderButton {
  id: string;
  icon: string;
  title: string;
  /** Place among the buttons, left first; without it `TREE_ITEM_ORDER`. Equal places keep registration order. */
  order?: number;
  run(evt: MouseEvent): void;
}

/** Place of an item or a header button without `order`. */
export const TREE_ITEM_ORDER = 50;

/** What a tree item does with a drag released on its row. */
export interface TreeItemDrop {
  /** In `dragover`, when drag data is hidden: whether a drop here does something; the row is highlighted. */
  accepts(dt: DataTransfer): boolean;
  /** The drag was released on the row. */
  drop(dt: DataTransfer): void;
  /** Also takes drops on the tree's empty space below the folders, highlighting this row. */
  space?: boolean;
}

export interface SortKeyDef {
  id: string;
  title: string;
  compare: (a: FileRecord, b: FileRecord) => number;
}

export interface BubaGridView {
  /** Content paths in display order. */
  pathsInOrder(): string[];
  /**
   * Rectangles of all tiles from the layout model, including those scrolled out of view, in grid body
   * coordinates.
   */
  tileRects(): { path: string; left: number; top: number; width: number; height: number }[];
  /**
   * A "path → extra tile classes" function, applied on every redraw. Providers with different keys coexist;
   * `null` removes only its own key. Without a key it is the legacy selection provider.
   */
  setTileMarks(fn: ((path: string) => string[]) | null, key?: string): void;
  /** View hotkeys: active only while the grid body has focus. */
  scope: Scope | null;
  /** Redraws. */
  refresh(): void;
  /** Scrolls the tile of `path` into view if it is not fully visible; a path the grid does not show is ignored. */
  reveal(path: string): void;
  /**
   * "Move cover" on the shown tile of folder `path` with a cover: drags move it, the wheel zooms; Enter or a
   * press elsewhere ends it with the frame, Esc with `null`. `false` when this grid does not show that tile.
   */
  frameCover?(path: string, done: (frame: CoverFrame | null) => void): boolean;
  /** Set by the selection module. */
  selectedPaths?: () => string[];
  /**
   * Shift anchor tile; `null` if there is none. Set by the selection module; the view stores it in the
   * history step.
   */
  selectionAnchor?: () => string | null;
}

/**
 * Part of the grid state from `openGrid`: `folder` and `deep` for a folder or "All files", `source` for a
 * module source.
 */
export type GridStatePatch = { folder: string | null; deep: boolean } | { source: GridSource };

/** What the connection object takes from Obsidian: the open grid views and changing their state. */
export interface AssetsHost {
  gridViews(): BubaGridView[];
  /** `newTab`: in a new tab (or the pane `Keymap.isModEvent` gives), as Ctrl+click or the middle button in
   *  Obsidian; otherwise in the open grid. */
  openGrid(patch: GridStatePatch, newTab?: boolean | PaneType): Promise<void>;
}

export interface BubaAssets {
  /** Registrations return a removal function; a repeated kind or id throws an error naming it. */
  registerGridSource(kind: string, provider: GridSourceProvider): () => void;
  registerTreeItem(item: TreeItem): () => void;
  registerTreeButton(button: TreeHeaderButton): () => void;
  registerSortKey(id: string, title: string, compare: (a: FileRecord, b: FileRecord) => number): () => void;
  gridSource(kind: string): GridSourceProvider | undefined;
  /** By `order`, equal places in registration order. */
  treeItems(): TreeItem[];
  /** By `order`, equal places in registration order. */
  treeButtons(): TreeHeaderButton[];
  /** In registration order. */
  sortKeys(): SortKeyDef[];
  /** Any registry changed; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  /** Expands tree item `id` in the open trees, as a press on its collapsed row; an expanded one stays. */
  expandTreeItem(id: string): void;
  /** Requests of `expandTreeItem`, for the trees; returns the unsubscribe. */
  onExpandTreeItem(listener: (id: string) => void): () => void;
  gridViews(): BubaGridView[];
  /** Redraws the open grids, e.g. when what a sort key compares has changed. */
  refreshGrids(): void;
  /** `newTab`: in a new tab (or the pane `Keymap.isModEvent` gives), as Ctrl+click or the middle button in
   *  Obsidian; otherwise in the open grid. */
  openGrid(source: GridSource, newTab?: boolean | PaneType): Promise<void>;
}

/** A registry's values by `order`, top or left first; `sort` is stable, so equal places keep registration order. */
const byOrder = <T extends { order?: number }>(registry: Map<string, T>): T[] =>
  [...registry.values()].sort((a, b) => (a.order ?? TREE_ITEM_ORDER) - (b.order ?? TREE_ITEM_ORDER));

export function createAssets(host: AssetsHost): BubaAssets {
  const sources = new Map<string, GridSourceProvider>();
  const items = new Map<string, TreeItem>();
  const buttons = new Map<string, TreeHeaderButton>();
  const sortKeys = new Map<string, SortKeyDef>();
  const listeners = new Set<() => void>();
  const expanders = new Set<(id: string) => void>();

  const changed = (): void => {
    for (const listener of [...listeners]) listener();
  };

  function add<T>(registry: Map<string, T>, key: string, value: T, name: string): () => void {
    if (registry.has(key)) throw new Error(`Buba: "${key}" is already in the ${name} registry`);
    registry.set(key, value);
    changed();
    return () => {
      if (registry.get(key) !== value) return;
      registry.delete(key);
      changed();
    };
  }

  return {
    registerGridSource: (kind, provider) => add(sources, kind, provider, 'grid source'),
    registerTreeItem: (item) => add(items, item.id, item, 'tree item'),
    registerTreeButton: (button) => add(buttons, button.id, button, 'tree button'),
    registerSortKey: (id, title, compare) => add(sortKeys, id, { id, title, compare }, 'sort key'),
    gridSource: (kind) => sources.get(kind),
    treeItems: () => byOrder(items),
    treeButtons: () => byOrder(buttons),
    sortKeys: () => [...sortKeys.values()],
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    expandTreeItem(id) {
      for (const listener of [...expanders]) listener(id);
    },
    onExpandTreeItem(listener) {
      expanders.add(listener);
      return () => {
        expanders.delete(listener);
      };
    },
    gridViews: () => host.gridViews(),
    refreshGrids() {
      for (const view of host.gridViews()) view.refresh();
    },
    openGrid(source, newTab) {
      if (source.kind === 'all') return host.openGrid({ folder: null, deep: false }, newTab);
      if (source.kind === 'folder') {
        const { path, withSubfolders } = source as FolderSource;
        return host.openGrid({ folder: path, deep: withSubfolders }, newTab);
      }
      return host.openGrid({ source }, newTab);
    },
  };
}
