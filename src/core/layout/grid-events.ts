// Event names of the grid, the tile menu and the tree folder menu. No `obsidian` import. Modules do not
// import each other, so the names live here in core, like `FILE_PANEL` of the viewer
// (src/core/viewer/edge.ts). Use these names only by importing them from here: a literal string in another
// `src` file fails a test; new grid events are added here. Values never change, since
// other modules listen to them. They are sent and received with `app.workspace.trigger` and
// `(workspace as Events).on`, since Obsidian's types do not know plugin events.

/**
 * Selection changed. Sent by the selection module (src/assets/grid/selection.ts) with the grid view and paths
 * in grid order. The file panel listens.
 */
export const SELECTION_CHANGE = 'buba:selection-change';

/**
 * Restore the selection from a tab history step. Sent by the grid view from `setEphemeralState`
 * (src/assets/grid/view.ts) with the view, paths and the anchor tile or `null`; the selection module applies
 * it. An event rather than a view field: a new view gets its ephemeral state before `layout-change`, which is
 * where the selection module attaches to views.
 */
export const SELECTION_RESTORE = 'buba:selection-restore';

/**
 * Files were just added: select them and show the first, so a new file does not get lost in the sort. Sent by
 * the actions module (src/assets/actions/import-drop.ts) after a drop, paste or "Add files" with the grid view
 * the files were added through, or `null` for an add from the tree or a folder menu (every grid that shows
 * them), and the written paths. The selection module applies it once the grid shows them.
 */
export const ADDED_SELECT = 'buba:added-select';

/**
 * Tile menu, sent before Obsidian's `file-menu` and `files-menu` so that module items go on top. Sent by the
 * actions module (src/assets/actions/file-menu.ts) with the menu, the tile files, source `MENU_SOURCE` and
 * the grid leaf. The panel module adds "File panel".
 */
export const TILE_MENU = 'buba:tile-menu';

/**
 * Module items for the grid "More options" (⋮) menu on phones. Sent by the grid view from `onPaneMenu`
 * (src/assets/grid/view.ts) only with `Platform.isPhone` and source `more-options`, before its own toggles,
 * with the menu and the view. The actions module adds the "Add…" items.
 */
export const GRID_MENU = 'buba:grid-menu';

/** Tile menu source in `TILE_MENU`, `file-menu` and `files-menu` events. */
export const MENU_SOURCE = 'buba-grid';

/**
 * Tree folder row menu, sent before the tree's own items and `file-menu` so that the module item comes first
 * ("Add files here…" at the very top). Sent by the tree (src/assets/tree/folder-menu.ts) with the menu, the
 * folder, the tree view type as source, and the tree leaf. The actions module adds "Add files here…" and does
 * not repeat it in `file-menu` of the same menu.
 */
export const FOLDER_MENU = 'buba:folder-menu';

/**
 * Grid state changed: folder or source, a back/forward step, view mode, sort or size, like `file-open` for a
 * file view. Sent by the grid view after rendering the new state (`#apply`, src/assets/grid/view.ts) with the
 * view. Not sent for redraws from the index or source, scrolling, the type filter or renaming the open
 * folder. Meant for the file panel; nothing listens to it yet.
 */
export const GRID_STATE_CHANGE = 'buba:grid-state-change';
