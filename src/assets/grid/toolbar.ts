// Grid toolbar: the path and the type filter with its quick reset, "View", tile size and its reset. On a
// phone the controls live in ⋮. The view menu is shared by desktop and phone; on desktop only the funnel
// opens type choice. State changes go through setGridState, the filter through TypeFilter; components and
// menu labels are public API.
import {
  ExtraButtonComponent,
  Menu,
  Modal,
  type MenuItem,
  SliderComponent,
  setTooltip,
  type App,
  type IconName,
} from 'obsidian';
import { iconButton } from '../../platform/icon-button.ts';
import { ownTitle } from '../../platform/menu-title.ts';
import { t } from '../../core/i18n/dict/grid.ts';
import { TILE_SIZE_STEP } from '../../core/layout/tile-size.ts';
import {
  TILE_SIZE_DEFAULT,
  TILE_SIZE_MAX,
  TILE_SIZE_MIN,
  nextGridState,
  type GridViewState,
} from '../../core/layout/view-state.ts';
import type { BubaAssets } from '../api.ts';
import { crumbs, type Folder } from './navigation.ts';
import {
  createTypeNote,
  noticeHidden,
  openTypeWindow,
  renderTypeNote,
  type TypeFilter,
  type TypeNote,
} from './type-filter.ts';
import './toolbar.css';

type SetGridState = (patch: Partial<GridViewState>) => void;

/**
 * Per-place view: `own` means the place has its own view, different from the common one; actions change the
 * place view memory.
 */
export interface LookControls {
  readonly own: boolean;
  reset(): void;
  makeCommon(): void;
}

/** What the grid view gives the toolbar on every draw. */
export interface ToolbarContext {
  readonly app: App;
  readonly assets: BubaAssets;
  sourceTitle(): string | null;
  /** The view's "File type": choice, filter result, counts for the window. */
  readonly types: TypeFilter;
  /** Per-place view; without it the menu has no place view items. */
  readonly look?: LookControls;
}

/** If the state's key is not in the registry, the menu marks date added: the grid sorts by it then. */
const FALLBACK_SORT = 'created';
/** "Then by" "None": no second level; a second-level key missing from the registry also shows "None". */
const THEN_NONE = 'none';
// View menu section headers, one per section, from the grid dictionary's `menu…` keys. "Sort by" and "Then
// by" follow Excel's "Sort" dialog. Direction has no header of its own: it sits in its level's section below
// the keys, as in Windows Explorer and Finder. "In all views" covers file names and tile size for every
// layout at once: the view's `showNames` and `size` do not depend on `layout`.

/** The desktop "View" menu button above the grid. */
const VIEW_ICON = 'settings-2';
/**
 * "Standard tile size" button right of the slider; the icon is that of the "Restore default" buttons in
 * Obsidian 1.14 settings.
 */
export const SIZE_RESET_ICON = 'rotate-ccw';
/** Sort directions: the label is a grid dictionary key, the icon a Lucide one. */
const DIRS = {
  asc: { title: 'ascending', icon: 'arrow-up-narrow-wide' },
  desc: { title: 'descending', icon: 'arrow-down-wide-narrow' },
} as const;
/** Grid layouts in list and menu order: equal squares, rows of one height, columns. */
const LAYOUTS = {
  uniform: 'layoutUniform',
  justified: 'layoutJustified',
  waterfall: 'layoutWaterfall',
} as const;
const FITS = { contain: 'fitContain', cover: 'fitCover' } as const;

/**
 * A menu section header: text in `span.buba-menu-label`, which toolbar.css uses to make the header small and
 * quiet and to align the section's icons with the text edge. The public API gives no class for a menu item,
 * so the header is a fragment, like the "Buba" label (menu-title.ts).
 */
function menuLabel(title: string): DocumentFragment {
  return createFragment((f) => f.createSpan({ cls: 'buba-menu-label', text: title }));
}

/** Tile size slider shared by the toolbar and the window: 80–400 px, step 10; tiles resize as it moves. */
function sizeSlider(el: HTMLElement): SliderComponent {
  return new SliderComponent(el).setLimits(TILE_SIZE_MIN, TILE_SIZE_MAX, TILE_SIZE_STEP).setInstant(true);
}

/**
 * Standard tile size, the one a new folder opens with: the common view's size, or 160 without a common view.
 * The place view memory (place-views.ts) knows it; the toolbar gets it through the connection object, like
 * the vault name, without importing the memory.
 */
const standardSizes = new WeakMap<BubaAssets, () => number>();

/** Called by grid command registration with the same object the grid view passes in `ctx.assets`. */
export function connectStandardSize(assets: BubaAssets, size: () => number): void {
  standardSizes.set(assets, size);
}

/** Standard size for this connection object; 160 if not connected. */
export function standardSizeOf(assets: BubaAssets): number {
  return standardSizes.get(assets)?.() ?? TILE_SIZE_DEFAULT;
}

/** Vault name for the path root, by connection object: the toolbar has no Obsidian access of its own. */
const vaultNames = new WeakMap<BubaAssets, () => string>();

/**
 * Called by toolbar registration (`registerSortKeys`) with the same object the grid view passes in
 * `ctx.assets`.
 */
export function connectToolbar(assets: BubaAssets, vaultName: () => string): void {
  vaultNames.set(assets, vaultName);
}

interface Toolbar {
  /** State and `setGridState` of the last call: element handlers are created once and read them from here. */
  state: GridViewState;
  setGridState: SetGridState;
  ctx: ToolbarContext;
  /** What is drawn now: the path is redrawn only when it changed. */
  shown: { path: string };
  /** Ancestors of the open folder, in Obsidian's view header markup. */
  readonly parents: HTMLElement;
  /** Open folder name or source title, separate from the ancestors, like the file name in a view header. */
  readonly current: HTMLElement;
  /** "PSD · 12 of 340" caption after the place name, grouped with it; visible on a phone too. */
  readonly typesNote: TypeNote;
  /** "File type" funnel, first among the controls; highlighted while the filter is on. */
  readonly types: ExtraButtonComponent;
  readonly resetTypes: ExtraButtonComponent;
  /** "View" button: view and sort menu; highlighted for a place with its own view. */
  readonly view: ExtraButtonComponent;
  readonly size: SliderComponent;
  /** "Standard tile size" after the slider; disabled at standard size, like "Reset filter" with no types. */
  readonly resetSize: ExtraButtonComponent;
}

/** The view's toolbar by its element: elements live as long as the view. */
const toolbars = new WeakMap<HTMLElement, Toolbar>();

/** What the view's toolbar shows now, by its content element: grid buttons and commands share one path. */
export interface ToolbarNow {
  readonly state: GridViewState;
  readonly setGridState: SetGridState;
  readonly ctx: ToolbarContext;
}

/** The toolbar of the view whose `contentEl` is `contentEl`; `null` if not drawn. */
export function toolbarOf(contentEl: HTMLElement): ToolbarNow | null {
  for (const child of Array.from(contentEl.children)) {
    const bar = toolbars.get(child as HTMLElement);
    if (bar) return { state: bar.state, setGridState: bar.setGridState, ctx: bar.ctx };
  }
  return null;
}

/**
 * The desktop control row always has the same elements in the same order: whatever changes in the view,
 * nothing appears or disappears; only button highlights and the slider position change.
 */
export function renderToolbar(
  el: HTMLElement,
  state: GridViewState,
  setGridState: SetGridState,
  ctx: ToolbarContext,
): void {
  const bar = toolbars.get(el) ?? build(el, state, setGridState, ctx);
  bar.state = state;
  bar.setGridState = setGridState;
  bar.ctx = ctx;
  renderPath(bar, ctx.sourceTitle(), vaultNames.get(ctx.assets)?.() ?? '/');
  renderTypeNote(bar.typesNote, ctx.types);
  bar.types.extraSettingsEl.toggleClass('is-active', ctx.types.tally !== null);
  bar.resetTypes.setDisabled(ctx.types.selected.size === 0);
  noticeHidden(el, ctx.types.hiddenNew);
  bar.view.extraSettingsEl.toggleClass('is-active', ctx.look?.own === true);
  if (bar.size.getValue() !== state.size) bar.size.setValue(state.size);
  bar.resetSize.setDisabled(state.size === standardSizeOf(ctx.assets));
}

function build(
  el: HTMLElement,
  state: GridViewState,
  setGridState: SetGridState,
  ctx: ToolbarContext,
): Toolbar {
  el.empty();
  const path = el.createDiv({ cls: 'buba-grid-path' });
  const parents = path.createDiv({ cls: 'view-header-title-parent' });
  const title = path.createDiv({ cls: 'buba-grid-path-title' });
  const current = title.createDiv({ cls: 'buba-grid-path-current' });
  const typesNote = createTypeNote(title, path);
  const controls = el.createDiv({ cls: 'buba-grid-toolbar-controls' });

  const resetTypes = new ExtraButtonComponent(controls).setIcon('filter-x').setTooltip(t('resetFilter'));
  const types = new ExtraButtonComponent(controls).setIcon('filter').setTooltip(t('fileType'));
  const view = new ExtraButtonComponent(controls).setIcon(VIEW_ICON).setTooltip(t('viewAndSort'));
  const size = sizeSlider(controls);
  setTooltip(size.sliderEl, t('tileSize'));
  const resetSize = new ExtraButtonComponent(controls)
    .setIcon(SIZE_RESET_ICON)
    .setTooltip(t('tileSizeDefault'));
  // Toolbar buttons are small Buba icon buttons (src/platform/icon-button.css).
  iconButton(resetTypes.extraSettingsEl, 'small');
  iconButton(types.extraSettingsEl, 'small');
  iconButton(view.extraSettingsEl, 'small');
  iconButton(resetSize.extraSettingsEl, 'small');

  const bar: Toolbar = {
    state,
    setGridState,
    ctx,
    shown: { path: '' },
    parents,
    current,
    typesNote,
    types,
    resetTypes,
    view,
    size,
    resetSize,
  };
  types.onClick(() => openTypeWindow(bar.ctx.app, bar.ctx.types));
  resetTypes.onClick(() => bar.ctx.types.set(new Set()));
  view.onClick(() => openViewMenu(bar));
  resetSize.onClick(() => {
    const standard = standardSizeOf(bar.ctx.assets);
    if (standard !== bar.state.size) bar.setGridState({ size: standard });
  });
  size.onChange((value) => {
    if (value !== bar.state.size) bar.setGridState({ size: value });
  });
  toolbars.set(el, bar);
  return bar;
}

/**
 * The desktop "View" menu: the phone ⋮ items without "File type…" and "Tile size…", which sit next to it. It
 * opens below the button, like Obsidian's "More" icon menus (the view header ⋮ and a plugin's ⋯ in settings,
 * Obsidian 1.14: `setParentElement(button).showAtPosition({ x, y: button bottom, width, overlap, left })`):
 * while the menu is open the button has `has-active-menu`, and clicking it does not open a second menu.
 */
function openViewMenu(bar: Toolbar): void {
  const button = bar.view.extraSettingsEl;
  if (button.hasClass('has-active-menu')) return;
  const menu = new Menu();
  paneMenu(menu, bar.ctx.app, bar.state, bar.setGridState, bar.ctx, true);
  if (bar.ctx.look) lookMenu(menu, bar.ctx.look);
  const at = button.getBoundingClientRect();
  menu
    .setParentElement(button)
    .showAtPosition({ x: at.x, y: at.bottom, width: at.width, overlap: true, left: true });
}

/**
 * The folder path from the vault root, or one part for a module source's title. Like Obsidian's view header:
 * ancestors with a separator after each go in `view-header-title-parent`, the last part sits apart and is not
 * clickable: inside `view-header-title-parent` it shrank with the ancestors to its first letters.
 */
function renderPath(bar: Toolbar, title: string | null, vaultName: string): void {
  const parts: readonly { label: string; folder?: Folder }[] =
    title === null ? crumbs(bar.state.folder, vaultName) : [{ label: title }];
  const shown = JSON.stringify(parts);
  if (shown === bar.shown.path) return;
  bar.shown.path = shown;
  bar.parents.empty();
  for (const { label, folder } of parts.slice(0, -1)) {
    const crumb = bar.parents.createSpan({ cls: 'view-header-breadcrumb', text: label });
    if (folder !== undefined) crumb.addEventListener('click', () => bar.setGridState({ folder }));
    bar.parents.createSpan({ cls: 'view-header-breadcrumb-separator', text: '/' });
  }
  bar.current.setText(parts.at(-1)?.label ?? '');
}

/**
 * View items: the view header's "More" (⋮) menu on a phone and the "View" button menu above the grid on
 * desktop share one list. The selected item has a check, each group is its own section under its own header.
 * Sort keys come from the registry in registration order, in two levels: "Sort by" and "Then by" with "None"
 * first; a level's direction is in its section below the keys. Section headers are `menuLabel`, without the
 * "Buba" label (menu-title.ts). On a phone "File type…" is in the "Folder" section and "Tile size…" in
 * "Tiles"; tile size is a window with the toolbar slider, only where there is no slider above the grid
 * (`slider`), since Obsidian menu items have neither sliders nor submenus; "File type…" opens the same
 * checkbox window as the funnel. The menu is built on every opening, so checks follow the current state;
 * items change it only through setGridState. `mixed`: a mixed menu that also has Obsidian items (⋮), where
 * our items get the "Buba" label; the "View" menu has none.
 *
 * Obsidian closes a menu after any item: its handler calls the item's callback, then `menu.hide()`, in the
 * same task (app.js 1.14.4, measured on Android 28.10). These items only change how the grid looks, and one
 * often sets several in a row: "Sort by", then "Then by" and its direction (word of the owner 28.10 08:40).
 * So they keep the menu open (`keepOpen`) and move their checks in place (`setChecked` redraws a shown
 * item); a press outside, Back, "File type…", "Tile size…" and the other items close it as before. The rows
 * do not change while the menu is open: the main key under "Then by", the second level's direction without a
 * key and the "Tiles" settings of another layout are greyed out rather than left out.
 */
export function paneMenu(
  menu: Menu,
  app: App,
  state: GridViewState,
  setGridState: SetGridState,
  ctx: ToolbarContext,
  slider = false,
  mixed = false,
): void {
  const own = (title: string) => (mixed ? ownTitle(title) : title);
  const stay = keepOpen(menu);
  // The state as the open menu has set it, for the checks.
  let now = state;
  const marks: {
    item: MenuItem;
    checked: (at: GridViewState) => boolean;
    off?: (at: GridViewState) => boolean;
  }[] = [];
  const view = (
    section: string,
    title: string,
    checked: (at: GridViewState) => boolean,
    patch: (at: GridViewState) => Partial<GridViewState>,
    icon?: IconName,
    off?: (at: GridViewState) => boolean,
  ) =>
    menu.addItem((it) => {
      it.setSection(`buba-grid-${section}`)
        .setTitle(own(title))
        .setChecked(checked(now) && !off?.(now))
        .setDisabled(off?.(now) ?? false)
        .onClick(() => {
          const change = patch(now);
          // As the grid takes it: a new sort key brings its natural direction.
          now = nextGridState(now, change);
          stay();
          setGridState(change);
          for (const mark of marks) {
            const disabled = mark.off?.(now) ?? false;
            mark.item.setChecked(mark.checked(now) && !disabled);
            if (mark.off) mark.item.setDisabled(disabled);
          }
        });
      if (icon) it.setIcon(icon);
      marks.push({ item: it, checked, ...(off && { off }) });
    });
  const action = (section: string, title: string, run: () => void) =>
    menu.addItem((it) =>
      it.setSection(`buba-grid-${section}`).setTitle(own(title)).setChecked(null).onClick(run),
    );
  const label = (section: string, title: string) =>
    menu.addItem((it) => it.setSection(`buba-grid-${section}`).setTitle(menuLabel(title)).setIsLabel(true));
  const deep = ctx.sourceTitle() === null && state.folder !== null;
  if (deep || !slider) label('folder', t('menuFolder'));
  if (deep)
    view(
      'folder',
      t('includeSubfolders'),
      (at) => at.deep,
      (at) => ({ deep: !at.deep }),
    );
  if (!slider) action('folder', t('fileTypeItem'), () => openTypeWindow(app, ctx.types));
  const keys = ctx.assets.sortKeys();
  const sortOf = (at: GridViewState) => (keys.some((key) => key.id === at.sort) ? at.sort : FALLBACK_SORT);
  label('sort', t('menuSortBy'));
  for (const key of keys)
    view(
      'sort',
      key.title,
      (at) => sortOf(at) === key.id,
      () => ({ sort: key.id }),
    );
  for (const dir of ['asc', 'desc'] as const)
    view(
      'sort',
      t(DIRS[dir].title),
      (at) => at.dir === dir,
      () => ({ dir }),
      DIRS[dir].icon,
    );
  const thenOf = (at: GridViewState) =>
    keys.some((key) => key.id === at.thenSort) ? at.thenSort : THEN_NONE;
  label('then', t('menuThenBy'));
  view(
    'then',
    t('thenNone'),
    (at) => thenOf(at) === THEN_NONE,
    () => ({ thenSort: THEN_NONE }),
  );
  for (const key of keys)
    view(
      'then',
      key.title,
      (at) => thenOf(at) === key.id,
      () => ({ thenSort: key.id }),
      undefined,
      (at) => sortOf(at) === key.id,
    );
  for (const dir of ['asc', 'desc'] as const)
    view(
      'then',
      t(DIRS[dir].title),
      (at) => at.thenDir === dir,
      () => ({ thenDir: dir }),
      DIRS[dir].icon,
      (at) => thenOf(at) === THEN_NONE,
    );
  label('layout', t('menuLayout'));
  for (const layout of ['uniform', 'justified', 'waterfall'] as const)
    view(
      'layout',
      t(LAYOUTS[layout]),
      (at) => at.layout === layout,
      () => ({ layout }),
    );
  // Only "Tiles" has a setting of its own, fit.
  label('fit', t('uniformSettings'));
  for (const fit of ['contain', 'cover'] as const)
    view(
      'fit',
      t(FITS[fit]),
      (at) => at.fit === fit,
      () => ({ fit }),
      undefined,
      (at) => at.layout !== 'uniform',
    );
  label('names', t('menuAllViews'));
  view(
    'names',
    t('showFileNames'),
    (at) => at.showNames,
    (at) => ({ showNames: !at.showNames }),
  );
  if (slider) return;
  action('names', t('tileSizeItem'), () => {
    // The window row is the slider followed by "Standard tile size", as in the desktop row above the grid.
    const modal = new Modal(app).setTitle(t('tileSize'));
    const standard = standardSizeOf(ctx.assets);
    let size = state.size;
    const row = modal.contentEl.createDiv({ cls: 'buba-grid-size' });
    const slider = sizeSlider(row);
    const reset = new ExtraButtonComponent(row).setIcon(SIZE_RESET_ICON).setTooltip(t('tileSizeDefault'));
    iconButton(reset.extraSettingsEl);
    const apply = (value: number): void => {
      reset.setDisabled(value === standard);
      if (value !== size) setGridState({ size: (size = value) });
    };
    slider.setValue(size).onChange(apply);
    reset.setDisabled(size === standard).onClick(() => {
      slider.setValue(standard);
      apply(standard);
    });
    modal.open();
  });
}

/**
 * Lets `menu` skip the one hide Obsidian calls right after an item's callback (see `paneMenu`): call the
 * returned function inside the callback. The skip ends with the task, so a callback that does not lead to a
 * hide leaves the next press outside closing the menu.
 */
function keepOpen(menu: Menu): () => void {
  let keep = false;
  const hide = menu.hide.bind(menu);
  menu.hide = () => {
    if (!keep) return hide();
    keep = false;
    return menu;
  };
  return () => {
    keep = true;
    queueMicrotask(() => (keep = false));
  };
}

/**
 * The view header's "More" (⋮) menu on desktop and phone and the "View" menu above the grid: a place with its
 * own view gets a section with "Reset to common view" and "Make this view common"; a place with the common
 * view gets no items. `mixed` as in `paneMenu`. `labelled` adds the "Folder view" header: in the "View" menu
 * and the phone ⋮, where every Buba section has a header; in the desktop ⋮ the section sits among Obsidian's
 * unlabelled sections, so it has none and the icons stay in Obsidian's column.
 */
export function lookMenu(menu: Menu, look: LookControls, mixed = false, labelled = !mixed): void {
  const own = (title: string) => (mixed ? ownTitle(title) : title);
  if (!look.own) return;
  if (labelled)
    menu.addItem((it) =>
      it
        .setSection('buba-grid-look')
        .setTitle(menuLabel(t('menuFolderView')))
        .setIsLabel(true),
    );
  menu.addItem((it) =>
    it
      .setSection('buba-grid-look')
      .setTitle(own(t('lookReset')))
      .setIcon('rotate-ccw')
      .onClick(() => look.reset()),
  );
  menu.addItem((it) =>
    it
      .setSection('buba-grid-look')
      .setTitle(own(t('lookMakeDefault')))
      .setIcon('copy-check')
      .onClick(() => look.makeCommon()),
  );
}
