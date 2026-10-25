// The Buba tree in the left sidebar: registry items at the top, below them the vault folders from the file
// index, each row "arrow → icon → name → count" with its path in `data-path`. A click shows the tiles in the
// main area, a double click or the arrow expands. An item with `menu` opens it on right-click, on a long
// press on a phone (the row listener is in src/platform/row-menus.ts; the row stays highlighted while
// the menu is open). A folder row has the folder menu (folder-menu.ts): "New subfolder…" and "New folder
// beside…", folder color and icon, then `file-menu`. The folder icon uses the folder's color and icon from
// storage, by default a grey `lucide-folder-open`. A new root folder comes from the "+ New folder" row under
// all folders (like "+ New tag"), the "New folder…" item of the "All files" menu, and the empty-space menu;
// there is no header button. The tree shows a created folder at once: expands its parents, scrolls to it,
// highlights its row and on desktop opens it in the grid; on a phone it leaves the tree open for styling
// (create-folder.ts). The header has the buttons of Obsidian's file explorer: "Sort order" (by name A to Z
// and Z to A, at all levels, kept in the leaf state) and "Collapse/Expand all". The row of the folder shown
// by the main grid has Obsidian's tree class `is-active`, like the open file in the file explorer; with
// "Reveal the open folder in the tree" on, the tree expands its parents and scrolls to it. On a computer a
// folder row can be dragged onto another folder row, "All files" or the empty space below the folders: the
// folder moves there (src/assets/actions/tree-drop.ts); an item with `drop` takes drops on its row.
// Delete deletes the highlighted folder after a confirmation while the last press was on a folder row, as in
// Eagle and file managers: the click opens the grid, yet the key belongs to the tree (folder-actions.ts).
// Layout uses Obsidian's tree classes; names are text only, and a color goes into `style` only after the
// pattern check.
import {
  getIcon,
  ItemView,
  Menu,
  Platform,
  setIcon,
  TFolder,
  type Events,
  type Plugin,
  type TAbstractFile,
  type View,
  type ViewStateResult,
  type WorkspaceLeaf,
} from 'obsidian';
import { ROOT } from '../../core/actions/new-folder.ts';
import { colorCss } from '../../core/color/value.ts';
import { t } from '../../core/i18n/dict/tree.ts';
import { folderIcon } from '../../core/icon/choices.ts';
import { GRID_STATE_CHANGE } from '../../core/layout/grid-events.ts';
import { movedPath, normalizeGridViewState } from '../../core/layout/view-state.ts';
import type { FolderLook } from '../../core/storage/types.ts';
import type { FileIndex } from '../../platform/files/file-index.ts';
import { iconButton } from '../../platform/icon-button.ts';
import { vaultFileIndex } from '../../platform/files/vault-index.ts';
import { settingsOf } from '../../platform/settings.ts';
import type { BubaAssets, TreeItem, TreeItemDrop } from '../api.ts';
import { contrastClasses } from '../color/dot.ts';
import { openGrid } from '../index.ts';
import { passportStorage } from '../../platform/passports.ts';
import { RowMenus, showRowMenu, type MenuAt, type RowMenuAt } from '../../platform/row-menus.ts';
import { endTreeRowDrag, startTreeRowDrag } from '../../platform/tree-drag.ts';
import { isTypingTarget } from '../../core/tags/keys.ts';
import { nameOf } from '../../platform/files/file-index.ts';
import { addNewFolderItem, drawNewFolderRow, openNewFolder } from './create-folder.ts';
import { deleteFolder } from './folder-actions.ts';
import { showFolderMenu, type FolderLookStorage } from './folder-menu.ts';
import {
  collapseAll,
  expandAll,
  expandedFromState,
  expandParents,
  FOLDER_ORDERS,
  orderFromState,
  renameExpanded,
  treeRows,
  type FolderOrder,
  type FolderRow,
} from './model.ts';
import './tree.css';

export const TREE_VIEW_TYPE = 'buba-tree';

/** A registry item row and what the item rendered under it while expanded. */
interface ItemRow {
  readonly item: TreeItem;
  readonly el: HTMLElement;
  readonly arrow: HTMLElement | null;
  readonly flair: HTMLElement | null;
  children: HTMLElement | null;
  cleanup: (() => void) | null;
  off: (() => void) | null;
}

/** A folder row icon and what it shows: the "looks" step changes only what changed. */
interface FolderIcon {
  readonly el: HTMLElement;
  /**
   * The folder's `.tree-item` row: it needs the color too, for its children's lines, the arrow and the name
   * (tree settings). Passed explicitly, not via `parentElement`.
   */
  readonly row: HTMLElement;
  icon: string;
  /**
   * Color after `colorCss`; `null`: grey icon; `undefined`: not painted yet (uncolored rows need `initial`).
   */
  color: string | null | undefined;
}

type Part = 'items' | 'counts' | 'folders' | 'looks';

const NO_LOOK: FolderLook = { color: null, icon: null };
const LOW_CONTRAST = ['mod-low-contrast-light', 'mod-low-contrast-dark'];
/** Folder row selector for the delegated row menu listener. */
const FOLDER_ROW = '.tree-item-self[data-path]';
/**
 * Empty-space mark: set on the view field while the event target is the field itself or a row block rather
 * than a row, like the empty space of Obsidian's file explorer (`e.targetNode === navFileContainerEl`, app.js
 * 1.14.4). The row menu listener looks up a row by selector from the target upward, and the field is an
 * ancestor of all rows: without the mark every row click would also be an empty-space click, and the browser
 * menu would be suppressed everywhere, including the "All tags" search field. The mark has no styles.
 */
const SPACE = 'buba-tree-space';
/** Selected row: Obsidian's active tree item class (`.tree-item-self.is-active`: background and color). */
const ACTIVE = 'is-active';
/** Row under a drop: the class Obsidian's file explorer puts on the folder under a drag, drawn by the theme. */
const OVER = 'is-being-dragged-over';
/** Order button and menu items use the file explorer's wording minus "file": the tree has only folders. */
const ORDER_TITLES = {
  alphabetical: 'orderAlphabetical',
  alphabeticalReverse: 'orderAlphabeticalReverse',
} as const satisfies Readonly<Record<FolderOrder, string>>;

export class TreeView extends ItemView {
  readonly #plugin: Plugin;
  readonly #assets: BubaAssets;
  readonly #index: FileIndex;
  /** Expanded folders live in the leaf state and survive a restart. */
  #expanded = new Set<string>();
  /** Folder order lives in the leaf state, like `sortOrder` of Obsidian's file explorer. */
  #order: FolderOrder = 'alphabetical';
  /** Expanded registry items, by id, while the view is open. */
  readonly #openItems = new Set<string>();
  #items: ItemRow[] = [];
  /** Folder rows of the last render and their counts, in the same order. */
  #rows: FolderRow[] = [];
  #flairs: HTMLElement[] = [];
  #icons: FolderIcon[] = [];
  /** Whether Obsidian knows an icon: `getIcon` builds an svg, so it is checked once per id. */
  readonly #known = new Map<string, boolean>();
  #toggleEl: HTMLElement | null = null;
  /** What the button does now: `true` collapses all, `false` expands all. */
  #collapse: boolean | null = null;
  #itemsEl: HTMLElement | null = null;
  #foldersEl: HTMLElement | null = null;
  /** Folder rows of the last render, in `#rows` order. */
  #selves: HTMLElement[] = [];
  /**
   * The selected folder, the last one shown: the main grid's folder or a new folder that the phone does not
   * open in the grid; `null` means no selection.
   */
  #active: string | null = null;
  #activeEl: HTMLElement | null = null;
  /** Folder to scroll to once its row is drawn: the index may learn about a new folder later. */
  #scrollTarget: string | null = null;
  /**
   * The field is hidden, so scrolling waits until it is shown (`onNodeInserted`); only one wait at a time.
   */
  #scrollQueued = false;
  // The index notifies on every change, and a folder deletion on every file: one re-render per frame.
  readonly #dirty = new Set<Part>();
  #frame = 0;
  #open = false;
  /**
   * Row menus of the tree: one finger, so the touch state is shared across the tree, as for "All tags" rows.
   */
  readonly #menus = new RowMenus();
  /** The empty-space menu has its own touch state: rows do not trigger it (the `SPACE` mark). */
  readonly #spaceMenus = new RowMenus();
  /** Whose Delete it is: the folder whose row name took the last press in the window, or `null` for the grid. */
  #keys: string | null = null;
  /** Item row highlighted under a drag. */
  #lit: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin, assets: BubaAssets) {
    super(leaf);
    this.#plugin = plugin;
    this.#assets = assets;
    this.#index = vaultFileIndex(plugin);
  }

  override getViewType(): string {
    return TREE_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return 'Buba';
  }

  override getIcon(): string {
    return 'bird';
  }

  /**
   * The open folder follows workspace events, like the open file in Obsidian's file
   * explorer (`file-open`) and the file panel (src/assets/inspector/follow.ts): the grid
   * changed state, a navigation view became active, a file opened; once after layout is
   * ready. Obsidian calls a view's `onload` before `onOpen` (`View.open`, app.js 1.14.4).
   */
  override onload(): void {
    const { workspace } = this.app;
    // Obsidian's types do not know our grid event, so the workspace is listened to as `Events`.
    this.registerEvent((workspace as Events).on(GRID_STATE_CHANGE, () => this.#follow()));
    this.registerEvent(
      workspace.on('active-leaf-change', (leaf) => {
        if (leaf?.view.navigation) this.#follow();
      }),
    );
    this.registerEvent(workspace.on('file-open', () => this.#follow()));
    workspace.onLayoutReady(() => this.#follow());
  }

  override async onOpen(): Promise<void> {
    this.#open = true;
    const header = this.containerEl.createDiv({ cls: 'nav-header', prepend: true });
    const buttons = header.createDiv({ cls: 'nav-buttons-container' });
    this.#addSortButton(buttons);
    this.#toggleEl = iconButton(buttons.createDiv({ cls: 'clickable-icon nav-action-button' }));
    this.#toggleEl.addEventListener('click', () => this.#toggleAll());
    this.contentEl.addClass('buba-tree');
    this.#itemsEl = this.contentEl.createDiv();
    this.#foldersEl = this.contentEl.createDiv();
    this.#listenFolders(this.#foldersEl);
    drawNewFolderRow(this.contentEl, () => this.#newFolder(ROOT));
    this.#listenSpace();
    this.#listenSpaceDrop();
    this.#listenDelete();
    this.register(this.#assets.onChange(() => this.#schedule('items')));
    this.register(this.#index.onChange(() => this.#schedule('folders')));
    // Folder looks have their own storage channel: tag edits do not wake the tree.
    const storage = this.#storage();
    if (storage) this.register(storage.onFolderLook(() => this.#schedule('looks')));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.#renamed(file, oldPath)));
    this.#mountItems();
    this.#renderFolders();
  }

  override async onClose(): Promise<void> {
    this.#open = false;
    if (this.#frame) this.contentEl.win.cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#spaceMenus.stop();
    this.#unmountItems();
  }

  override getState(): Record<string, unknown> {
    return { expanded: [...this.#expanded], sortOrder: this.#order };
  }

  /**
   * Expansion and order come from the layout. A view loaded after the layout is ready (a deferred leaf opened
   * for the first time, the first opening of the phone sidebar) gets it after `#follow` from `onload`
   * (`setViewState` → `View.open` → `setState`, app.js 1.14.4): with "Reveal the open folder in the tree" on,
   * the open folder's parents are expanded again on top of the layout, as Obsidian's saved folds
   * (`loadFolds`) only expand and never collapse what `revealActiveFile` expanded.
   */
  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    this.#expanded = expandedFromState(state);
    this.#order = orderFromState(state);
    if (this.#active !== null && settingsOf(this.#plugin).autoRevealFolder) this.#revealRow(this.#active);
    else this.#schedule('folders');
    await super.setState(state, result);
  }

  /**
   * A closed view does not render: otherwise items would subscribe again and nobody would unsubscribe them.
   */
  #schedule(part: Part): void {
    if (!this.#open) return;
    this.#dirty.add(part);
    if (this.#frame) return;
    this.#frame = this.contentEl.win.requestAnimationFrame(() => {
      this.#frame = 0;
      const dirty = new Set(this.#dirty);
      this.#dirty.clear();
      if (dirty.has('items')) this.#mountItems();
      else if (dirty.has('counts')) this.#updateCounts();
      if (dirty.has('folders')) this.#renderFolders();
      if (dirty.has('looks')) this.#updateLooks();
    });
  }

  // Registry items: "icon → name → count"; an item with `render` gets an arrow and its content under the row.

  #mountItems(): void {
    if (!this.#itemsEl) return;
    this.#unmountItems();
    for (const item of this.#assets.treeItems()) {
      const el = this.#itemsEl.createDiv({ cls: 'tree-item' });
      const self = el.createDiv({ cls: 'tree-item-self is-clickable' });
      const arrow = item.render ? this.#arrow(self) : null;
      if (item.icon) this.#icon(self, item.icon);
      self.createDiv({ cls: 'tree-item-inner', text: item.title });
      const flair = item.count ? this.#flair(self, item.count()) : null;
      const row: ItemRow = { item, el, arrow, flair, children: null, cleanup: null, off: null };
      if (flair && item.onChange) row.off = item.onChange(() => this.#schedule('counts'));
      // The arrow, and the whole row of an item without a grid ("All tags"), toggles on every click, as in
      // Obsidian's file explorer; on the name the second click of a double click does not open the grid
      // again, the `dblclick` below expands.
      self.addEventListener('click', (evt) => {
        if (item.menu && !this.#menus.click()) return;
        if (arrow?.contains(evt.target as Node) || !item.source) this.#toggleItem(row);
        else if (evt.detail <= 1) void this.#assets.openGrid(item.source);
      });
      self.addEventListener('dblclick', (evt) => {
        if (item.source && arrow && !arrow.contains(evt.target as Node)) this.#toggleItem(row);
      });
      if (item.menu) this.#listenMenu(self, item);
      if (item.drop) this.#listenDrop(self, item.drop);
      this.#items.push(row);
      this.#showItem(row, this.#openItems.has(item.id));
    }
  }

  /**
   * Item menu (`menu`): right-click, a long press on a phone (src/platform/row-menus.ts); the row stays
   * highlighted while the menu is open. Obsidian does not show an empty menu (`showAtPosition`, app.js 1.13.7
   * and 1.14.4) and then does not highlight the row either (1.14.4).
   */
  #listenMenu(self: HTMLElement, item: TreeItem): void {
    this.#menus.attach(self, (at) => {
      const menu = new Menu();
      item.menu?.(menu);
      showRowMenu(menu, at);
    });
  }

  /**
   * Item drop (`drop`): the row is highlighted while it takes what is dragged over it, as a folder row under
   * a tile; the item decides and does the rest.
   */
  #listenDrop(self: HTMLElement, drop: TreeItemDrop): void {
    self.addEventListener('dragover', (evt) => this.#overDrop(evt, self, drop));
    self.addEventListener('dragleave', (evt) => {
      if (!self.contains(evt.relatedTarget as Node | null)) this.#light(null);
    });
    self.addEventListener('drop', (evt) => this.#dropOn(evt, drop));
  }

  #overDrop(evt: DragEvent, self: HTMLElement, drop: TreeItemDrop): void {
    const dt = evt.dataTransfer;
    if (!dt || !drop.accepts(dt)) return this.#light(null);
    evt.preventDefault();
    dt.dropEffect = 'move';
    this.#light(self);
  }

  #dropOn(evt: DragEvent, drop: TreeItemDrop): void {
    this.#light(null);
    const dt = evt.dataTransfer;
    if (!dt || !drop.accepts(dt)) return;
    evt.preventDefault();
    drop.drop(dt);
  }

  #light(row: HTMLElement | null): void {
    if (this.#lit === row) return;
    this.#lit?.removeClass(OVER);
    this.#lit = row;
    row?.addClass(OVER);
  }

  /**
   * The empty space of the tree (the field, the folder block, the "+ New folder" row) takes a drop for the
   * item whose `drop` has `space`, highlighting that item's row: a folder dropped below the folders goes to
   * the vault root, shown on "All files".
   */
  #listenSpaceDrop(): void {
    const field = this.contentEl;
    const spaceItem = (evt: DragEvent): ItemRow | null => {
      const at = evt.target as Element | null;
      const space = at === field || at === this.#foldersEl || !!at?.closest?.('.buba-tree-new');
      return space ? (this.#items.find((row) => row.item.drop?.space) ?? null) : null;
    };
    field.addEventListener('dragover', (evt) => {
      const row = spaceItem(evt);
      if (row?.item.drop) this.#overDrop(evt, row.el.firstElementChild as HTMLElement, row.item.drop);
      else if (this.#foldersEl?.contains(evt.target as Node | null)) this.#light(null);
    });
    field.addEventListener('dragleave', (evt) => {
      if (!field.contains(evt.relatedTarget as Node | null)) this.#light(null);
    });
    field.addEventListener('drop', (evt) => {
      const row = spaceItem(evt);
      if (row?.item.drop) this.#dropOn(evt, row.item.drop);
    });
    field.addEventListener('dragend', () => {
      this.#light(null);
      endTreeRowDrag();
    });
  }

  /**
   * Delete on the highlighted folder, with the confirmation of "Delete" in its menu. The key is the tree's
   * while the last press in the window was a left press on the name of the highlighted folder's row: a click
   * there opens the grid and moves focus to it, as before, yet the user's attention is on the tree, as in
   * Eagle. A press on the arrow or on another row that did not open it, or a drag that moved it, leaves the
   * key with the grid: the press is remembered by path and must match the highlight. A press anywhere else
   * gives the key back; it is ignored in a text field, during input composition, with a modifier, while a
   * dialog or a menu is open, and after a delete. Listened in the capture phase, before the grid's own Delete.
   */
  #listenDelete(): void {
    const win = this.contentEl.win;
    this.registerDomEvent(
      win,
      'pointerdown',
      (evt) => {
        const at = evt.target as Element | null;
        const row =
          evt.button === 0 && this.contentEl.contains(at) ? at?.closest?.<HTMLElement>(FOLDER_ROW) : null;
        this.#keys = row && !at?.closest('.collapse-icon') ? (row.dataset.path ?? null) : null;
      },
      { capture: true },
    );
    this.registerDomEvent(
      win,
      'keydown',
      (evt) => {
        if (this.#keys === null || this.#keys !== this.#active || evt.key !== 'Delete') return;
        if (evt.isComposing || evt.keyCode === 229) return;
        if (evt.ctrlKey || evt.metaKey || evt.altKey || evt.shiftKey) return;
        const doc = this.contentEl.doc;
        if (isTypingTarget(evt.target as Element | null)) return;
        if (doc.body.querySelector('.modal-container, .menu')) return;
        const folder = this.app.vault.getFolderByPath(this.#keys);
        if (!folder) return;
        evt.preventDefault();
        evt.stopPropagation();
        if (evt.repeat) return;
        this.#keys = null;
        void deleteFolder(this.app, folder, passportStorage(this.#plugin));
      },
      { capture: true },
    );
  }

  #unmountItems(): void {
    this.#menus.stop();
    for (const row of this.#items) {
      this.#showItem(row, false);
      row.off?.();
    }
    this.#items = [];
    this.#itemsEl?.empty();
  }

  #toggleItem(row: ItemRow): void {
    if (!row.item.render) return;
    const open = !this.#openItems.has(row.item.id);
    if (open) this.#openItems.add(row.item.id);
    else this.#openItems.delete(row.item.id);
    this.#showItem(row, open);
  }

  /**
   * Expand: a container under the row with the item's `render`; collapse: item cleanup, container removed.
   */
  #showItem(row: ItemRow, open: boolean): void {
    const { item } = row;
    if (!item.render) return;
    row.el.toggleClass('is-collapsed', !open);
    row.arrow?.toggleClass('is-collapsed', !open);
    if (open && !row.children) {
      row.children = row.el.createDiv({ cls: 'tree-item-children' });
      const cleanup = item.render(row.children);
      row.cleanup = typeof cleanup === 'function' ? cleanup : null;
    } else if (!open && row.children) {
      row.cleanup?.();
      row.cleanup = null;
      row.children.remove();
      row.children = null;
    }
  }

  #updateCounts(): void {
    for (const { item, flair } of this.#items) if (flair && item.count) flair.setText(String(item.count()));
  }

  // Folders: model rows as nested `tree-item`s, like Obsidian's trees; clicks are delegated. If the rows are
  // the same as last time (a file was added or removed), only the counts change: a full rebuild of 2,000
  // expanded folders takes about 0.1 s.

  #renderFolders(): void {
    if (!this.#foldersEl) return;
    const rows = treeRows(this.#index, this.#expanded, this.#order);
    const before = this.#rows;
    const same =
      rows.length === before.length &&
      rows.every(
        (row, at) =>
          row.path === before[at]!.path &&
          row.expanded === before[at]!.expanded &&
          row.hasChildren === before[at]!.hasChildren,
      );
    if (same) {
      rows.forEach((row, at) => {
        if (row.count !== before[at]!.count) this.#flairs[at]!.setText(String(row.count));
      });
    } else this.#buildFolders(this.#foldersEl, rows);
    this.#rows = rows;
    this.#markActive();
    this.#scrollToTarget();
    // One button for both actions, like "Collapse all" / "Expand all" in Obsidian's file explorer.
    const collapse = rows.some((row) => row.expanded);
    if (this.#toggleEl && this.#collapse !== collapse) {
      this.#collapse = collapse;
      setIcon(this.#toggleEl, collapse ? 'chevrons-down-up' : 'chevrons-up-down');
      this.#toggleEl.setAttribute('aria-label', t(collapse ? 'collapseAll' : 'expandAll'));
    }
  }

  #buildFolders(container: HTMLElement, rows: readonly FolderRow[]): void {
    container.empty();
    this.#flairs = [];
    this.#icons = [];
    this.#selves = [];
    const parents: HTMLElement[] = [container];
    for (const row of rows) {
      parents.length = row.depth + 1;
      const el = parents[row.depth]!.createDiv({ cls: 'tree-item' });
      const self = el.createDiv({ cls: 'tree-item-self is-clickable', attr: { 'data-path': row.path } });
      // On a phone a long press opens the menu, and "Move folder to..." moves; a draggable row would start a
      // system drag on iOS instead, as with tiles (src/assets/actions/tile-drag.ts).
      if (!Platform.isMobile) self.draggable = true;
      this.#selves.push(self);
      if (row.hasChildren) this.#arrow(self).toggleClass('is-collapsed', !row.expanded);
      const icon: FolderIcon = {
        el: self.createDiv({ cls: 'buba-tree-icon' }),
        row: el,
        icon: '',
        color: undefined,
      };
      this.#paint(icon, row.path);
      this.#icons.push(icon);
      self.createDiv({ cls: 'tree-item-inner', text: row.name });
      this.#flairs.push(this.#flair(self, row.count));
      if (row.expanded) parents.push(el.createDiv({ cls: 'tree-item-children' }));
      else el.addClass('is-collapsed');
    }
  }

  // Folder looks: each visible row's icon from storage, in place; 2,000 rows are 2,000 `Map` lookups.

  #updateLooks(): void {
    this.#rows.forEach((row, at) => {
      const icon = this.#icons[at];
      if (icon) this.#paint(icon, row.path);
    });
  }

  /**
   * Icon: `setIcon` only when the id changes; color: `--buba-color` after `colorCss` and the contrast
   * classes, as for the tag dot, on the icon and on the row (`mod-folder-color`). An uncolored row gets
   * `--buba-color: initial`, otherwise it would inherit the parent folder's color.
   */
  #paint(icon: FolderIcon, path: string): void {
    const look = this.#storage()?.folderLook(path) ?? NO_LOOK;
    const id = folderIcon(look.icon, (each) => this.#knows(each));
    if (id !== icon.icon) {
      setIcon(icon.el, id);
      icon.icon = id;
    }
    const color = colorCss(look.color);
    if (color === icon.color) return;
    icon.color = color;
    icon.el.toggleClass('mod-color', color !== null);
    icon.el.setCssProps({ '--buba-color': color ?? '' });
    icon.row.toggleClass('mod-folder-color', color !== null);
    icon.row.setCssProps({ '--buba-color': color ?? 'initial' });
    const low = contrastClasses(look.color);
    for (const cls of LOW_CONTRAST) {
      icon.el.toggleClass(cls, low.includes(cls));
      icon.row.toggleClass(cls, low.includes(cls));
    }
  }

  #knows(id: string): boolean {
    let known = this.#known.get(id);
    if (known === undefined) {
      known = getIcon(id) !== null;
      this.#known.set(id, known);
    }
    return known;
  }

  /** The plugin's `storage` field, as for tags; absent if journals failed: grey icons, no look menu items. */
  #storage(): FolderLookStorage | undefined {
    return (this.#plugin as Plugin & { storage?: FolderLookStorage }).storage;
  }

  #listenFolders(container: HTMLElement): void {
    const target = (evt: MouseEvent) => {
      const at = evt.target as Element;
      const self = at.closest<HTMLElement>(FOLDER_ROW);
      return self ? { self, path: self.dataset.path ?? '', onArrow: !!at.closest('.collapse-icon') } : null;
    };
    // The folder row menu is delegated: rows get rebuilt, the listeners are one set per container.
    this.#menus.attach(container, (at) => this.#folderMenu(at), FOLDER_ROW);
    container.addEventListener('click', (evt) => {
      const hit = target(evt);
      // A click after a long press (the menu is already shown) or a finger move does not open the folder.
      if (!hit || !this.#menus.click()) return;
      // The arrow toggles on every click, as in Obsidian's file explorer: a click within the double-click
      // time is the second of a series (`detail` 2), and dropping it left the folder as it was. On the name
      // the second click does not open the grid again, the `dblclick` below expands.
      if (hit.onArrow) this.#toggleFolder(hit.path);
      else if (evt.detail <= 1) void openGrid(this.#plugin, hit.path);
    });
    container.addEventListener('dblclick', (evt) => {
      const hit = target(evt);
      if (hit && !hit.onArrow && hit.self.hasClass('mod-collapsible')) this.#toggleFolder(hit.path);
    });
    // A folder row drag: the ghost shows the row's icon and name; drops are taken by folder rows
    // (src/assets/actions/tree-drop.ts) and by "All files" and the empty space (`#listenSpaceDrop`).
    container.addEventListener('dragstart', (evt) => {
      const hit = target(evt);
      if (!hit) return;
      const icon = this.#icons[this.#rows.findIndex((row) => row.path === hit.path)]?.icon || 'folder';
      startTreeRowDrag(evt, { kind: 'folder', path: hit.path }, icon, nameOf(hit.path));
    });
  }

  /** The row's folder from Obsidian: the file index may be ahead of the vault, and then there is no menu. */
  #folderMenu(at: RowMenuAt): void {
    const folder = this.app.vault.getFolderByPath(at.row.dataset.path ?? '');
    if (folder)
      showFolderMenu(
        this.app,
        this.#storage(),
        folder,
        at,
        TREE_VIEW_TYPE,
        this.leaf,
        (parent) => this.#newFolder(parent),
        passportStorage(this.#plugin),
      );
  }

  // New folder: the name dialog, then showing it in all Buba trees and in the grid (`newFolder` below).

  #newFolder(parent: string): void {
    newFolder(this.#plugin, parent);
  }

  /**
   * Empty space: right-click, a long press on a phone: a menu with "New folder…" in
   * the root; no row, so nothing to highlight. The `SPACE` mark is set by a
   * listener attached to the same field before the menu listener, so it runs first.
   */
  #listenSpace(): void {
    const space = this.contentEl;
    const mark = (evt: Event) => {
      const at = evt.target;
      space.toggleClass(SPACE, at === space || at === this.#itemsEl || at === this.#foldersEl);
    };
    space.addEventListener('contextmenu', mark);
    space.addEventListener('touchstart', mark, { passive: true });
    this.#spaceMenus.attach(space, (at) => this.#spaceMenu(at), `.${SPACE}`);
  }

  #spaceMenu(at: MenuAt): void {
    const menu = new Menu();
    addNewFolderItem(menu, () => this.#newFolder(ROOT));
    showRowMenu(menu, 'evt' in at ? { evt: at.evt } : { x: at.x, y: at.y });
  }

  /**
   * Shows a created folder: parents expanded, row selected, scroll on the next
   * render. The selection lasts until what is shown changes: on desktop the
   * grid opens this folder right away, on a phone the grid stays where it was.
   */
  reveal(path: string): void {
    this.#active = path;
    this.#revealRow(path);
  }

  /**
   * The main view showed something else: the selection moves to the main grid folder's row
   * and off the previous one, like `onFileOpen` of Obsidian's file explorer; with "Reveal
   * the open folder in the tree" on, the parents are also expanded and the row scrolled
   * into view (`autoRevealFile`). The setting is read at navigation time, so changing it
   * on the settings page applies at once. The same folder leaves the tree untouched.
   */
  #follow(): void {
    const folder = this.#shownFolder();
    if (folder === this.#active) return;
    this.#active = folder;
    if (folder !== null && settingsOf(this.#plugin).autoRevealFolder) this.#revealRow(folder);
    else this.#markActive();
  }

  /**
   * The main grid's folder. The main view follows Obsidian's "Backlinks" rule, as for the file panel
   * (follow.ts): the active leaf if its view is a navigation view, otherwise the last active leaf of the main
   * area; grids are the open views from `assets.gridViews()`. A grid on a tag, "All files" and the root have
   * no tree row, and a main view that is not a grid gives `null`.
   */
  #shownFolder(): string | null {
    const { workspace } = this.app;
    const active = workspace.getActiveViewOfType(ItemView);
    const main = active?.navigation ? active : (workspace.getMostRecentLeaf()?.view ?? null);
    const grid = this.#assets.gridViews().find((each) => (each as unknown) === main);
    if (!grid) return null;
    const { folder, source } = normalizeGridViewState((grid as unknown as View).getState());
    return source || folder === null || folder === ROOT ? null : folder;
  }

  /** Parents expanded, scroll to the row on the next render; the expansion is saved in the layout. */
  #revealRow(path: string): void {
    this.#expanded = expandParents(this.#expanded, path);
    this.#scrollTarget = path;
    this.#saveFolders();
  }

  #markActive(): void {
    const at = this.#active === null ? -1 : this.#rows.findIndex((row) => row.path === this.#active);
    const el = at === -1 ? null : (this.#selves[at] ?? null);
    if (el === this.#activeEl) return;
    this.#activeEl?.removeClass(ACTIVE);
    el?.addClass(ACTIVE);
    this.#activeEl = el;
  }

  /**
   * Once the folder row is drawn, the field scrolls so the whole row is visible; if it is not there yet, wait
   * for the next render. The field is scrolled by rectangles rather than `scrollIntoView`, which also moves
   * ancestors with `overflow: hidden`. The visible part is the field without its padding: on a phone Obsidian
   * 1.14.4 puts the tree's floating buttons over the bottom of the field and gives it bottom padding for them
   * (app.css, `.is-mobile.is-floating-nav.is-phone … .nav-header ~ div:last-child`). A hidden field (the
   * phone drawer closed, the tree tab behind another) returns zero rectangles, so scrolling waits until it is
   * shown, like `revealActiveFile` of Obsidian's file explorer (`isShown`, `onNodeInserted`, app.js 1.14.4).
   */
  #scrollToTarget(): void {
    if (this.#scrollTarget === null) return;
    const at = this.#rows.findIndex((row) => row.path === this.#scrollTarget);
    const self = at === -1 ? undefined : this.#selves[at];
    if (!self) return;
    const field = this.contentEl;
    if (!field.isShown()) {
      if (this.#scrollQueued) return;
      this.#scrollQueued = true;
      field.onNodeInserted(() => {
        this.#scrollQueued = false;
        this.#scrollToTarget();
      }, true);
      return;
    }
    this.#scrollTarget = null;
    const box = field.getBoundingClientRect();
    const pad = field.win.getComputedStyle(field);
    const top = box.top + (parseFloat(pad.paddingTop) || 0);
    const bottom = box.bottom - (parseFloat(pad.paddingBottom) || 0);
    const row = self.getBoundingClientRect();
    if (row.top < top) field.scrollTop -= top - row.top;
    else if (row.bottom > bottom) field.scrollTop += row.bottom - bottom;
  }

  /**
   * "Sort order" is the button and menu of Obsidian's file explorer (`addSortButton`,
   * app.js 1.14.4): a menu without icons, the current order checked, the button
   * highlighted while the menu is open; a press while it is open does nothing.
   */
  #addSortButton(buttons: HTMLElement): void {
    const button = iconButton(buttons.createDiv({ cls: 'clickable-icon nav-action-button' }));
    setIcon(button, 'lucide-sort-asc');
    button.setAttribute('aria-label', t('sortOrder'));
    button.addEventListener('click', (evt) => {
      evt.preventDefault();
      if (button.hasClass('has-active-menu')) return;
      const menu = new Menu().setNoIcon();
      for (const order of FOLDER_ORDERS)
        menu.addItem((item) =>
          item
            .setTitle(t(ORDER_TITLES[order]))
            .setChecked(order === this.#order)
            .onClick(() => this.setOrder(order)),
        );
      menu.setParentElement(button).showAtMouseEvent(evt);
    });
  }

  /**
   * Applies the order at all levels and saves it in the layout, like the file explorer's `setSortOrder`; also
   * used by commands.
   */
  setOrder(order: FolderOrder): void {
    if (order === this.#order) return;
    this.#order = order;
    this.#saveFolders();
  }

  #toggleFolder(path: string): void {
    if (!this.#expanded.delete(path)) this.#expanded.add(path);
    this.#saveFolders();
  }

  #toggleAll(): void {
    const anyExpanded = treeRows(this.#index, this.#expanded).some((row) => row.expanded);
    this.#expanded = anyExpanded ? collapseAll() : expandAll(this.#index);
    this.#saveFolders();
  }

  /** "Collapse all folders" (a command), the same way as the "Collapse all" branch of the button. */
  collapseAll(): void {
    this.#expanded = collapseAll();
    this.#saveFolders();
  }

  /** "Expand all folders" (a command): always expands, even if some are open; same path as "Expand all". */
  expandAll(): void {
    this.#expanded = expandAll(this.#index);
    this.#saveFolders();
  }

  // Expansion is kept by path: a renamed or moved folder takes it along, as in Obsidian's file explorer.
  // Files do not change expansion; `rename` also fires for every nested file.
  // The open folder stays highlighted at its new place: a folder dragged into a collapsed one would otherwise
  // vanish from view, so its new parents are expanded and the tree scrolls to it.
  #renamed(file: TAbstractFile, oldPath: string): void {
    if (!(file instanceof TFolder)) return;
    this.#expanded = renameExpanded(this.#expanded, oldPath, file.path);
    const active = this.#active === null ? null : movedPath(this.#active, oldPath, file.path);
    if (active !== null && active !== this.#active) {
      this.#active = active;
      this.#revealRow(active);
    } else this.#saveFolders();
  }

  // Obsidian saves the layout itself only when it creates the view, so state changes are saved explicitly.
  #saveFolders(): void {
    this.#schedule('folders');
    this.app.workspace.requestSaveLayout();
  }

  // Row parts.

  #arrow(self: HTMLElement): HTMLElement {
    self.addClass('mod-collapsible');
    const arrow = self.createDiv({ cls: 'tree-item-icon collapse-icon' });
    setIcon(arrow, 'right-triangle');
    return arrow;
  }

  #icon(self: HTMLElement, icon: string): void {
    setIcon(self.createDiv({ cls: 'buba-tree-icon' }), icon);
  }

  #flair(self: HTMLElement, count: number): HTMLElement {
    return self
      .createDiv({ cls: 'tree-item-flair-outer' })
      .createSpan({ cls: 'tree-item-flair', text: String(count) });
  }
}

/**
 * New folder in `parent`, from the folder menu, the "All files" menu, empty space and the "+ New folder" row:
 * the name dialog, creation, then showing it in every Buba tree; on desktop it opens in the grid through the
 * same `openGrid` as a folder click.
 */
export function newFolder(plugin: Plugin, parent: string): void {
  openNewFolder(plugin.app, parent, (path) => {
    for (const leaf of plugin.app.workspace.getLeavesOfType(TREE_VIEW_TYPE))
      if (leaf.view instanceof TreeView) leaf.view.reveal(path);
    if (!Platform.isMobile) void openGrid(plugin, path);
  });
}
