// The "All tags" item of the Buba tree: it expands into a search field and a tag tree
// (src/core/tags/tag-list.ts), like Obsidian's Tags view with nested tags and Eagle's "All Tags". Grouped
// tags sit under a group row with an arrow; a group shows a Lucide `tags` icon in its color, the number of
// files with any of its tags, and the `split` exclusive icon; a tag shows a color circle (grey without color)
// and its file count; icon and circle sit in their own cell before the name. A group icon whose
// color is hard to see on the theme background gets an outline, like a folder icon. The tag or group row
// whose list is shown in the main grid is marked `is-active`, like the open folder in the tree. Counts
// include only files that exist in the vault: as many tiles as a click shows through the "tag" or "group"
// source (src/assets/tags/sources.ts). The arrow and a double-click collapse a group; collapsed state is per
// device. Right-click, or long press on phones, opens the group or tag menu (tag-menu.ts). Adding or removing
// a tag, changing a flag or color, or adding or deleting a file updates the list and the item counter at
// once; when only counts change, only they are updated. Editing file content (a note autosave) does not
// change tags, and counts are not recomputed. Typing in the search redraws the list after a pause, like
// Obsidian's tags pane; a long list is drawn in portions: the first at once, the rest one per frame. Rows use
// Obsidian's tree classes, names are rendered as text only, colors only after `colorCss`. A tag lives until
// deleted: a declared tag without files shows with count 0; tags are created from the "New tag" row at the
// bottom of the list and the "New tag…" item of the "All tags" menu (the tree item's `menu`). On a computer a
// tag row can be dragged onto a group row, which moves the tag into that group, or onto "All tags", which
// takes it out of its group: the same move as "Move to group…" and "Remove from group" in its menu, with
// the same confirmations. The group row under the drag is highlighted as a folder row under a tile.
import {
  debounce,
  ItemView,
  Platform,
  SearchComponent,
  setIcon,
  type App,
  type Events,
  type Menu,
  type Plugin,
  type View,
} from 'obsidian';
import { colorCss } from '../../core/color/value.ts';
import { t } from '../../core/i18n/dict/tags.ts';
import { GRID_STATE_CHANGE } from '../../core/layout/grid-events.ts';
import { normalizeGridViewState, type GridSourceState } from '../../core/layout/view-state.ts';
import { tagKey } from '../../core/storage/types.ts';
import type { TagStorage } from '../../core/storage/types.ts';
import {
  createTagList,
  existingTreeCounts,
  readOpenGroups,
  tagTreeRows,
  toggleOpenGroup,
  type TagList,
  type TagTreeCounts,
  type TagTreeRow,
} from '../../core/tags/tag-list.ts';
import { tagDropGroup } from '../../core/tags/groups.ts';
import { hasBubaDragData, isOwnTileDrag, readBubaDragPaths } from '../../platform/canvas-drag.ts';
import { endTreeRowDrag, startTreeRowDrag, treeRowDrag } from '../../platform/tree-drag.ts';
import { pathsVersionOf } from '../../platform/files/file-index.ts';
import { vaultFileIndex } from '../../platform/files/vault-index.ts';
import type { BubaAssets } from '../api.ts';
import { contrastClasses, tagDot } from '../color/dot.ts';
import { dragExpander, type DragExpander } from '../../platform/drag-expand.ts';
import { RowMenus } from '../../platform/row-menus.ts';
import { tagFiles } from './picker.ts';
import { setListedTags } from './listed.ts';
import { moveTag, openNewTag, showGroupMenu, showTagMenu, type Exists } from './tag-menu.ts';
import './tag-list.css';

/** Expanded groups are device state, not vault data, so they live in local storage, like the device id. */
const OPEN_KEY = 'buba-tag-groups-open';

/**
 * Own "four dots in a diamond" icon; Obsidian's icon set (Lucide) has no such shape, so
 * it is registered with the standard `addIcon` (by the tags entry point, src/assets/tags/index.ts). Group
 * rows now draw Lucide `tags`; this icon remains available in the folder icon picker. Obsidian puts a custom
 * icon into `<svg viewBox="0 0 100 100">` without attributes (app.js 1.13.7), so the drawing is a nested svg
 * on Lucide's 24×24 grid: fill and stroke `currentColor`, stroke width from the theme (`--icon-stroke` of
 * Obsidian icons). Obsidian sets the icon id as a class on its svg (app.js 1.13.7), so the id must differ
 * from the group row class `buba-tag-group`.
 */
export const GROUP_ICON = 'buba-tag-group-icon';
export const GROUP_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="100" height="100" fill="currentColor" stroke="currentColor" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="5" r="1.5"/><circle cx="5" cy="12" r="1.5"/>' +
  '<circle cx="19" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>';

interface ListContext {
  app: App;
  assets: BubaAssets;
  list: TagList;
  storage: () => TagStorage | undefined;
  counts: () => TagTreeCounts;
  /** Whether a file exists in the vault, for counts in the menu's confirmation dialogs. */
  exists: Exists;
  onChange: (listener: () => void) => () => void;
  /**
   * Source of the main grid (`null` if the main view is not a grid or is a folder grid) and its change
   * subscription.
   */
  shownSource: () => GridSourceState | null;
  onShownChange: (listener: () => void) => () => void;
}

/**
 * Source of the main grid, by the same main-view rule as the tree's open folder (`#shownFolder`,
 * src/assets/tree/view.ts) and the file panel: the active leaf if its view is a navigation view, otherwise
 * the most recent leaf of the main area; grids are the open views from `assets.gridViews()`. A folder grid
 * and "All files" have no source: `null`.
 */
function shownGridSource(app: App, assets: BubaAssets): GridSourceState | null {
  const { workspace } = app;
  const active = workspace.getActiveViewOfType(ItemView);
  const main = active?.navigation ? active : (workspace.getMostRecentLeaf()?.view ?? null);
  const grid = assets.gridViews().find((each) => (each as unknown) === main);
  if (!grid) return null;
  return normalizeGridViewState((grid as unknown as View).getState()).source ?? null;
}

/** The same list: a tag or group with the same name, case-insensitively. */
function sameSource(row: GridSourceState, shown: GridSourceState): boolean {
  if (row.kind !== shown.kind) return false;
  const name = row.kind === 'tag' ? 'tag' : row.kind === 'tag-group' ? 'group' : null;
  if (name === null) return false;
  const [a, b] = [row[name], shown[name]];
  return typeof a === 'string' && typeof b === 'string' && tagKey(a) !== null && tagKey(a) === tagKey(b);
}

/**
 * Storage is looked up on every request: the plugin's `storage` field may appear after registration, and
 * until then there are no tags. The storage change subscription is set as soon as storage is found, at
 * registration or on the first request; plugin unload removes it together with the file index subscription.
 * Tag and group counts come from indexed files, the same as the grids, and are computed in one pass until the
 * next storage change or index path set change (`pathsVersion`): editing a file with the same path does not
 * reset them. Tags with these counts also form the list used by tag dialogs (`setListedTags`), removed on
 * plugin unload. The list model (`createTagList`) keeps the search text while the plugin is loaded: collapse
 * and expand the item and the new field takes the query from it.
 */
export function registerTagList(
  plugin: Plugin,
  assets: BubaAssets,
  storage: () => TagStorage | undefined,
): void {
  const index = vaultFileIndex(plugin);
  const list = createTagList();
  const listeners = new Set<() => void>();
  let counts: TagTreeCounts | null = null;
  // Index paths, once per index change: they feed tree counts and the "file exists" check in menu dialogs.
  let files: { paths: string[]; known: Set<string> | null } | null = null;
  const indexed = () => (files ??= { paths: index.allFiles().map((file) => file.path), known: null });
  const exists = (path: string): boolean => {
    const own = indexed();
    return (own.known ??= new Set(own.paths)).has(path);
  };
  const changed = (): void => {
    counts = null;
    for (const listener of [...listeners]) listener();
  };
  const onChange = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  let followed: TagStorage | undefined;
  let unfollow = (): void => {};
  const current = (): TagStorage | undefined => {
    const found = storage();
    if (found !== followed) {
      unfollow();
      followed = found;
      counts = null;
      unfollow = found?.onChange(changed) ?? (() => {});
    }
    return found;
  };
  plugin.register(() => unfollow());
  let seen = pathsVersionOf(index);
  plugin.register(
    index.onChange(() => {
      const version = pathsVersionOf(index);
      if (version !== null && version === seen) return;
      seen = version;
      files = null;
      changed();
    }),
  );
  current();
  const tree = (): TagTreeCounts => {
    const found = current();
    if (!found) return { tags: [], groups: new Map(), titles: new Map() };
    counts ??= existingTreeCounts(indexed().paths, found, exists);
    return counts;
  };
  // The same list goes to tag dialogs and their counts (listed.ts): the same numbers as the tree, one cache
  // per change.
  plugin.register(setListedTags(plugin.app, () => tree().tags));

  // Shown tag: the grid changed state or a navigation view became active, as for the tree's open folder
  // (src/assets/tree/view.ts, `onload`).
  const shownListeners = new Set<() => void>();
  const shownChanged = (): void => {
    for (const listener of [...shownListeners]) listener();
  };
  const { workspace } = plugin.app;
  // Obsidian's types do not know the grid's own event, so the workspace is listened to as `Events`.
  plugin.registerEvent((workspace as Events).on(GRID_STATE_CHANGE, shownChanged));
  plugin.registerEvent(
    workspace.on('active-leaf-change', (leaf) => {
      if (leaf?.view.navigation) shownChanged();
    }),
  );

  const context: ListContext = {
    app: plugin.app,
    assets,
    list,
    storage: current,
    counts: tree,
    exists,
    onChange,
    shownSource: () => shownGridSource(plugin.app, assets),
    onShownChange: (listener) => {
      shownListeners.add(listener);
      return () => {
        shownListeners.delete(listener);
      };
    },
  };
  plugin.register(
    assets.registerTreeItem({
      id: 'all-tags',
      title: t('allTags'),
      icon: 'tag',
      count: () => tree().tags.length,
      onChange,
      render: (containerEl) => renderTagList(containerEl, context),
      menu: (menu) => addNewTagItem(menu, context),
      drop: {
        accepts: (dt) => tagInto(dt, null) !== undefined,
        drop: (dt) => dropTag(dt, null, context),
      },
    }),
  );
}

/** The dragged tag, if a drop with `dt` moves it into `group` (`null`: out of its group); else `undefined`. */
function tagInto(dt: DataTransfer | null, group: string | null): string | undefined {
  const drag = treeRowDrag(dt);
  return drag?.kind === 'tag' && tagDropGroup(drag.tag, group) !== undefined ? drag.tag : undefined;
}

/** A tag released on a group row or on "All tags": the move of its menu, with its confirmations. */
function dropTag(dt: DataTransfer, group: string | null, context: ListContext): void {
  const tag = tagInto(dt, group);
  endTreeRowDrag();
  const storage = context.storage();
  if (tag !== undefined && storage) moveTag(context.app, storage, tag, group, context.exists);
}

/**
 * "New tag…" item of the "All tags" menu: with an ellipsis since it opens a dialog, like Obsidian's menu
 * items; absent while there is no storage.
 */
function addNewTagItem(menu: Menu, context: ListContext): void {
  if (!context.storage()) return;
  menu.addItem((item) =>
    item
      .setTitle(t('menuNewTag'))
      .setIcon('plus')
      .onClick(() => {
        const storage = context.storage();
        if (storage) openNewTag(context.app, storage, null);
      }),
  );
}

function loadOpen(app: App): Set<string> {
  return readOpenGroups(app.loadLocalStorage(OPEN_KEY));
}

/** A row without its count is its identity: if only the count changed, the rows are the same. */
const withoutCount = ({ count: _count, ...row }: TagTreeRow) => row;

/** Search typing pause, as in Obsidian's tags pane search (`debounce(…, 300, true)`, app.js 1.13.7). */
const SEARCH_PAUSE_MS = 300;

/**
 * Rows per render: the first portion at once, the rest one per following frame. Rendering all 10k rows at
 * once froze the window for about 2 s, the first 200 take tens of milliseconds (measured). Obsidian's trees
 * also lay out long lists in blocks of 50 rows, each next one in idle time or on the next frame
 * (`renderBlockSize`, `requestIdleCallback` with a `requestAnimationFrame` fallback in app.js 1.14.4).
 */
const PORTION = 200;

/**
 * Search field and the tag tree below it. Typing goes into the `list` model at once, while rows are drawn
 * once after a typing pause: each keystroke postpones the render, like Obsidian's tags pane search; with 10k
 * tags a render per keystroke cost up to 2 s. The T tag dialog filters without a pause, like Obsidian's
 * suggesters. The arrow and the first render draw at once; storage and index signals at most once per frame,
 * since a tag batch fires one per change and the file index one per note save. Unchanged rows are not redrawn
 * and the field is not recreated, so the typed text, focus and a click in progress survive; if only counts
 * changed, the new counts go into the drawn cells, like folder counts in the Buba tree
 * (src/assets/tree/view.ts). A new field (item expanded again) gets the query from the model before the first
 * render; `setValue` does not fire the callback. Cleanup cancels a pending render.
 *
 * Rows are drawn in portions (`PORTION`): the first at once, the rest one per frame, appended to the end of
 * the list without touching what is drawn, so scrolling, clicks and the menu's highlighted row keep working
 * during the fill; "New tag" goes below the last row. A portion may end inside an expanded group, and the
 * next one continues its container. A new keystroke drops the unfinished part. To keep the scroll position
 * from jumping, a redraw draws at once as many rows as could have been visible: after a storage change as
 * many as were drawn, after an arrow up to the collapsed or expanded group plus one portion after it.
 */
function renderTagList(containerEl: HTMLElement, context: ListContext): () => void {
  const { app, list } = context;
  const { win } = containerEl;
  const search = new SearchComponent(containerEl).setPlaceholder(t('findTag')).setValue(list.query());
  const listEl = containerEl.createDiv({ cls: 'buba-tag-tree' });
  const menus = new RowMenus();
  const expander = dragExpander();
  listEl.addEventListener('dragend', () => expander.clear());
  let open = loadOpen(app);
  // What is drawn: the signature of all rows without counts, the rows of the last render, each drawn row's
  // count cell with its count, and the container for the next row of a group; `tail` means "New tag" is not
  // drawn yet.
  let shown = '';
  let rows: TagTreeRow[] = [];
  let flairs: { el: HTMLElement; count: number }[] = [];
  let children: HTMLElement = listEl;
  let tail = false;
  // Drawn rows with their sources, and the marked row of the shown tag or group: one, like the tree's open
  // folder.
  let selves: { self: HTMLElement; source: GridSourceState }[] = [];
  let activeEl: HTMLElement | null = null;
  const markActive = (): void => {
    const shown = context.shownSource();
    const found =
      shown === null ? null : (selves.find((each) => sameSource(each.source, shown))?.self ?? null);
    if (found === activeEl) return;
    activeEl?.removeClass('is-active');
    found?.addClass('is-active');
    activeEl = found;
  };
  // Frame of the next portion and the render number: a portion of an older render does not draw even if its
  // frame could not be cancelled.
  let more = 0;
  let pass = 0;
  const halt = (): void => {
    pass += 1;
    if (more) win.cancelAnimationFrame(more);
    more = 0;
  };
  const resume = (): void => {
    if (more) return;
    const mine = pass;
    more = win.requestAnimationFrame(() => {
      more = 0;
      if (mine === pass) portion(flairs.length + PORTION);
    });
  };
  /**
   * Rows up to the `until`-th; if not all are drawn the next portion goes on the next frame, otherwise "New
   * tag".
   */
  const portion = (until: number): void => {
    const end = Math.min(until, rows.length);
    for (let at = flairs.length; at < end; at += 1) {
      const row = rows[at];
      if (!row) break;
      let el: HTMLElement;
      let self: HTMLElement;
      if (row.kind === 'group')
        ({ children, flair: el, self } = drawGroup(listEl, row, context, menus, toggle, expander));
      else ({ flair: el, self } = drawTag(row.depth ? children : listEl, row, context, menus));
      flairs.push({ el, count: row.count });
      selves.push({ self, source: row.source });
    }
    markActive();
    if (flairs.length < rows.length) resume();
    else if (tail) {
      tail = false;
      drawNewTag(listEl, context);
    }
  };
  /**
   * Rows for the query, expanded state and storage. Same rows: new counts go into drawn cells and the
   * unfinished part continues with them; different rows: the list is redrawn, `keep` rows at once but no
   * fewer than a portion, the rest in portions.
   */
  const draw = (keep: number): void => {
    const storage = context.storage();
    const next = storage ? tagTreeRows(context.counts(), list.query(), open, storage) : [];
    // Without storage the list is empty and has no "New tag" row: the signature differs from an empty list
    // with storage.
    const signature = storage ? JSON.stringify(next.map(withoutCount)) : '';
    rows = next;
    if (signature === shown) {
      flairs.forEach((flair, at) => {
        const row = next[at];
        if (!row || flair.count === row.count) return;
        flair.count = row.count;
        flair.el.setText(String(row.count));
      });
      // Typing stopped the fill, but the query after the pause is unchanged.
      if (flairs.length < rows.length) resume();
      return;
    }
    shown = signature;
    halt();
    listEl.empty();
    flairs = [];
    selves = [];
    activeEl = null;
    children = listEl;
    tail = storage !== undefined;
    portion(Math.max(PORTION, keep));
  };
  const toggle = (group: string): void => {
    // Rows above the group are unchanged: they and a portion after the group are drawn at once, so the group
    // stays put.
    const at = rows.findIndex((row) => row.kind === 'group' && row.key === group);
    open = toggleOpenGroup(loadOpen(app), group);
    app.saveLocalStorage(OPEN_KEY, [...open]);
    draw(Math.max(at, 0) + PORTION);
  };
  let frame = 0;
  const off = context.onChange(() => {
    if (frame) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      draw(flairs.length);
    });
  });
  const offShown = context.onShownChange(markActive);
  const later = debounce(() => draw(PORTION), SEARCH_PAUSE_MS, true);
  search.onChange((text) => {
    list.setQuery(text);
    // Rows of the old query are no longer needed: the unfinished part is dropped from the first keystroke.
    halt();
    later();
  });
  draw(PORTION);
  return () => {
    off();
    offShown();
    later.cancel();
    halt();
    menus.stop();
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
  };
}

/**
 * Start of a row: the icon cell and the name as text. A group's cell holds a Lucide `tags` icon in its color
 * (`--buba-color` only after `colorCss`; grey from the styles without color), a tag's a color circle, a
 * colorless tag's a grey circle. A group color hard to see on the theme background gets the same
 * `mod-low-contrast-<theme>` classes as the dot (src/assets/color/dot.ts): a white icon in the light theme
 * gets an outline (tag-list.css).
 */
function inner(item: HTMLElement, self: HTMLElement, row: TagTreeRow): void {
  // The color also goes on the `.tree-item` row ("Tree" settings: child guide lines, group arrow, name); a
  // row without color gets `initial`, otherwise a tag would inherit its group's color.
  const css = colorCss(row.color);
  item.toggleClass('mod-tag-color', css !== null);
  item.addClass(...contrastClasses(row.color));
  item.setCssProps({ '--buba-color': css ?? 'initial' });
  const cell = self.createDiv({ cls: 'buba-tag-cell', attr: { 'aria-hidden': 'true' } });
  if (row.kind === 'tag') tagDot(cell, row.color);
  else {
    cell.addClass('mod-group', ...contrastClasses(row.color));
    setIcon(cell, 'tags');
    if (css !== null) cell.setCssProps({ '--buba-color': css });
  }
  self.createDiv({ cls: 'tree-item-inner', text: row.title });
}

/**
 * Group row with Obsidian's tree classes, like a folder: arrow (`collapse-icon`), icon, name, exclusive mark
 * and count; a click opens the group grid, the arrow and a double-click collapse or expand it. A double-click
 * on the arrow itself is two clicks and two toggles, as with Obsidian's tree arrows (`onCollapseClick`,
 * app.js 1.13.7), so a `dblclick` bubbling up from the arrow does not toggle the row. The exclusive mark sits
 * in the row, not in the count block, where its bottom edge landed on the text baseline. Returns the
 * container for its tags, the count cell and the row itself.
 */
function drawGroup(
  listEl: HTMLElement,
  row: Extract<TagTreeRow, { kind: 'group' }>,
  context: ListContext,
  menus: RowMenus,
  toggle: (group: string) => void,
  expander: DragExpander,
): { children: HTMLElement; flair: HTMLElement; self: HTMLElement } {
  const item = listEl.createDiv({ cls: 'tree-item buba-tag-group' });
  const self = item.createDiv({ cls: 'tree-item-self is-clickable', attr: { 'data-group': row.key } });
  if (row.collapsible) {
    self.addClass('mod-collapsible');
    const arrow = self.createDiv({ cls: 'tree-item-icon collapse-icon' });
    setIcon(arrow, 'right-triangle');
    arrow.toggleClass('is-collapsed', !row.expanded);
    arrow.addEventListener('click', (evt) => {
      evt.stopPropagation();
      toggle(row.key);
    });
    // The target may be the arrow or the svg and path inside it, hence `contains` rather than equality.
    self.addEventListener('dblclick', (evt) => {
      if (!arrow.contains(evt.target as Node | null)) toggle(row.key);
    });
  }
  item.toggleClass('is-collapsed', !row.expanded);
  inner(item, self, row);
  if (row.exclusive) {
    const mark = self.createSpan({
      cls: 'buba-tag-group-mark',
      attr: { 'aria-label': t('exclusiveMark') },
    });
    // Prefixed: bare `split` in Obsidian 1.14.4 is the old name of `git-branch-plus` (alias map in app.js).
    setIcon(mark, 'lucide-split');
  }
  const flair = drawCount(self, row.count);
  self.addEventListener('click', (evt) => {
    if (evt.detail <= 1 && menus.click()) void context.assets.openGrid(row.source);
  });
  menus.attach(self, (at) => {
    const storage = context.storage();
    if (storage) showGroupMenu(context.app, storage, row.title, at, context.exists);
  });
  self.addEventListener('dragover', (evt) => {
    // A collapsed group held under a drag expands after Obsidian's wait, as a folder: a tag dropped into it
    // shows inside, tiles can reach its tags.
    if (row.collapsible) expander.over(self.win, row.key, !row.expanded, () => toggle(row.key));
    if (tagInto(evt.dataTransfer, row.title) === undefined || !evt.dataTransfer) return;
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'move';
    self.addClass('is-being-dragged-over');
  });
  self.addEventListener('dragleave', (evt) => {
    if (self.contains(evt.relatedTarget as Node | null)) return;
    self.removeClass('is-being-dragged-over');
    expander.clear();
  });
  self.addEventListener('drop', (evt) => {
    self.removeClass('is-being-dragged-over');
    expander.clear();
    if (tagInto(evt.dataTransfer, row.title) === undefined || !evt.dataTransfer) return;
    evt.preventDefault();
    dropTag(evt.dataTransfer, row.title, context);
  });
  return { children: row.expanded ? item.createDiv({ cls: 'tree-item-children' }) : listEl, flair, self };
}

/**
 * Tag row: a cell with the color circle, the name (short inside a group), the count; a click opens the tag
 * grid. Returns the count cell and the row itself.
 */
function drawTag(
  parent: HTMLElement,
  row: Extract<TagTreeRow, { kind: 'tag' }>,
  context: ListContext,
  menus: RowMenus,
): { flair: HTMLElement; self: HTMLElement } {
  const item = parent.createDiv({ cls: 'tree-item' });
  const self = item.createDiv({ cls: 'tree-item-self is-clickable', attr: { 'data-tag': row.id } });
  inner(item, self, row);
  const flair = drawCount(self, row.count);
  self.addEventListener('click', (evt) => {
    if (evt.detail <= 1 && menus.click()) void context.assets.openGrid(row.source);
  });
  menus.attach(self, (at) => {
    const storage = context.storage();
    if (storage) showTagMenu(context.app, storage, row.tag, at, context.exists);
  });
  // On a phone a long press opens the menu with "Move to group…"; a draggable row would start a system drag.
  if (!Platform.isMobile) {
    self.draggable = true;
    self.addEventListener('dragstart', (evt) =>
      startTreeRowDrag(evt, { kind: 'tag', tag: row.tag }, 'tag', row.tag),
    );
    self.addEventListener('dragend', () => endTreeRowDrag());
  }
  const accepts = (evt: DragEvent): boolean => hasBubaDragData(evt.dataTransfer);
  self.addEventListener('dragover', (evt) => {
    if (!accepts(evt) || !evt.dataTransfer) return;
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'copy';
    self.addClass('is-being-dragged-over');
  });
  self.addEventListener('dragleave', (evt) => {
    if (!self.contains(evt.relatedTarget as Node | null)) self.removeClass('is-being-dragged-over');
  });
  self.addEventListener('dragend', () => self.removeClass('is-being-dragged-over'));
  self.addEventListener('drop', (evt) => {
    self.removeClass('is-being-dragged-over');
    if (!accepts(evt)) return;
    evt.preventDefault();
    if (!isOwnTileDrag(evt.dataTransfer)) return;
    const storage = context.storage();
    const paths = [...new Set(readBubaDragPaths(evt.dataTransfer) ?? [])].filter(context.exists);
    if (storage && paths.length) void tagFiles(context.app, storage, paths, row.tag);
  });
  return { flair, self };
}

/**
 * Row count in Obsidian's tree count block (`tree-item-flair`); returns the cell so a count update touches
 * only it.
 */
function drawCount(self: HTMLElement, count: number): HTMLElement {
  return self
    .createDiv({ cls: 'tree-item-flair-outer' })
    .createSpan({ cls: 'tree-item-flair', text: String(count) });
}

/**
 * "+ New tag" row at the bottom of the list, like Obsidian's "New note": a plus in the icon cell and the name
 * in muted text. A click (a tap on phones) opens the name dialog prefilled with the search text: a tag that
 * was not found gets created under that name.
 */
function drawNewTag(listEl: HTMLElement, context: ListContext): void {
  const self = listEl
    .createDiv({ cls: 'tree-item buba-tag-new' })
    .createDiv({ cls: 'tree-item-self is-clickable', attr: { role: 'button' } });
  const cell = self.createDiv({ cls: 'buba-tag-cell mod-new', attr: { 'aria-hidden': 'true' } });
  setIcon(cell, 'plus');
  self.createDiv({ cls: 'tree-item-inner', text: t('newTag') });
  self.addEventListener('click', () => {
    const storage = context.storage();
    if (storage) openNewTag(context.app, storage, null, context.list.query().trim());
  });
}
