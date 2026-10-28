// Look of Buba trees from the "Appearance" settings: classes and one variable on the main window's `body`,
// the way Obsidian does it for "Indentation guides" (`toggleClass("show-indentation-guide", …)`) and font
// size (`--font-text-size`, app.js 1.14.4); Obsidian copies main `body` classes and properties to popout
// windows itself. The rules are at the end of src/assets/tree/tree.css and src/assets/tags/tag-list.css,
// scoped to these classes. The "Buba label in menus" setting lives here too: a class only when it is off,
// rule in src/platform/menu-title.css. Values go through `normalizeSettings`, so nothing from `data.json`
// reaches CSS raw: only known classes and a validated integer with `%`. Without `document` (windowless test
// suites) this does nothing and does not throw: an error after a write would land in the settings page's
// `.catch` and report "data.json not saved".
import { coverInFront, normalizeSettings } from '../core/settings/settings.ts';

export const TREE_LINES_GREY = 'buba-tree-lines-grey';
export const TREE_LINES_COLOR = 'buba-tree-lines-color';
/** The arrows after the name are off; no class by default (src/assets/tree/tree.css). */
export const TREE_ARROWS_OFF = 'buba-tree-arrows-off';
export const TREE_ARROW_COLOR = 'buba-tree-arrow-color';
export const TREE_NAME_FOLDER = 'buba-tree-name-folder';
export const TREE_NAME_TAG = 'buba-tree-name-tag';
/** Long names in the trees on one line, cut with "…" (src/assets/tree/tree.css). */
export const TREE_NAME_ONE_LINE = 'buba-tree-name-one-line';
/** Folder tile look in the grid, one class per option (src/assets/grid/tiles.css). */
export const FOLDER_TILE_PEEK = 'buba-folder-tile-peek';
export const FOLDER_TILE_SOLID = 'buba-folder-tile-solid';
/** One picture as the cover, on top of `FOLDER_TILE_PEEK` (src/assets/grid/folder-tiles.css). */
export const FOLDER_TILE_ONE = 'buba-folder-tile-one';
/** Folder cover on the front of the tile (`coverInFront`); behind it has no class (src/assets/grid/folder-tiles.css). */
export const FOLDER_COVER_FRONT = 'buba-folder-cover-front';
/** Back plate behind a cover in front in the cover's color; grey has no class (src/assets/grid/folder-tiles.css). */
export const FOLDER_PLATE_COVER = 'buba-folder-plate-cover';
/** Selected folder tile as a tinted or framed area; the line around the front has no class (folder-tiles.css). */
export const FOLDER_SELECT_FILL = 'buba-folder-select-fill';
export const FOLDER_SELECT_FRAME = 'buba-folder-select-frame';
/** Look of a file without a picture in the grid, one class per option (src/assets/grid/file-tiles.css). */
export const FILE_TILE_SHAPE = 'buba-file-tile-shape';
export const FILE_TILE_PLATE = 'buba-file-tile-plate';
export const FILE_TILE_SMALL = 'buba-file-tile-small';
/** The "Buba label in menus" setting is off; no class by default. */
export const MENU_OWN_OFF = 'buba-menu-own-off';
/** All look classes; the "Off" guide lines option has no class. */
export const TREE_LOOK_CLASSES = [
  TREE_LINES_GREY,
  TREE_LINES_COLOR,
  TREE_ARROWS_OFF,
  TREE_ARROW_COLOR,
  TREE_NAME_FOLDER,
  TREE_NAME_TAG,
  TREE_NAME_ONE_LINE,
  FOLDER_TILE_PEEK,
  FOLDER_TILE_SOLID,
  FOLDER_TILE_ONE,
  FOLDER_COVER_FRONT,
  FOLDER_PLATE_COVER,
  FOLDER_SELECT_FILL,
  FOLDER_SELECT_FRAME,
  FILE_TILE_SHAPE,
  FILE_TILE_PLATE,
  FILE_TILE_SMALL,
  MENU_OWN_OFF,
] as const;
/** Opacity of colored guide lines, e.g. `40%`. */
export const TREE_GUIDE_ALPHA = '--buba-tree-guide-alpha';

function mainBody(): HTMLElement | null {
  return typeof document === 'undefined' ? null : (document.body ?? null);
}

/**
 * Sets the `body` classes and variable from settings: on load, on external change and from the settings page.
 */
export function applyTreeLook(settings: unknown, body: HTMLElement | null = mainBody()): void {
  if (!body) return;
  const look = normalizeSettings(settings);
  body.toggleClass(TREE_LINES_GREY, look.treeLines === 'grey');
  body.toggleClass(TREE_LINES_COLOR, look.treeLines === 'color');
  body.toggleClass(TREE_ARROWS_OFF, !look.treeArrows);
  body.toggleClass(TREE_ARROW_COLOR, look.treeArrowColor);
  body.toggleClass(TREE_NAME_FOLDER, look.treeFolderNameColor);
  body.toggleClass(TREE_NAME_TAG, look.treeTagNameColor);
  body.toggleClass(TREE_NAME_ONE_LINE, look.treeNameOneLine);
  // One picture is the files-inside tile with a single card: it takes both classes.
  body.toggleClass(FOLDER_TILE_PEEK, look.folderTile !== 'solid');
  body.toggleClass(FOLDER_TILE_ONE, look.folderTile === 'one');
  body.toggleClass(FOLDER_TILE_SOLID, look.folderTile === 'solid');
  body.toggleClass(FOLDER_COVER_FRONT, coverInFront(look));
  body.toggleClass(FOLDER_PLATE_COVER, look.folderPlate === 'cover');
  body.toggleClass(FOLDER_SELECT_FILL, look.folderSelect === 'fill');
  body.toggleClass(FOLDER_SELECT_FRAME, look.folderSelect === 'frame');
  body.toggleClass(FILE_TILE_SHAPE, look.fileTile === 'shape');
  body.toggleClass(FILE_TILE_PLATE, look.fileTile === 'plate');
  body.toggleClass(FILE_TILE_SMALL, look.fileTile === 'small');
  body.toggleClass(MENU_OWN_OFF, !look.menuOwnLabel);
  body.setCssProps({ [TREE_GUIDE_ALPHA]: `${look.treeLinesOpacity}%` });
}

/** On plugin unload: removes the classes and the variable. */
export function clearTreeLook(body: HTMLElement | null = mainBody()): void {
  if (!body) return;
  body.removeClass(...TREE_LOOK_CLASSES);
  body.setCssProps({ [TREE_GUIDE_ALPHA]: '' });
}
