// Look of Buba trees from the "Appearance" settings: classes and one variable on the main window's `body`,
// the way Obsidian does it for "Indentation guides" (`toggleClass("show-indentation-guide", …)`) and font
// size (`--font-text-size`, app.js 1.14.4); Obsidian copies main `body` classes and properties to popout
// windows itself. The rules are at the end of src/assets/tree/tree.css and src/assets/tags/tag-list.css,
// scoped to these classes. The "Buba label in menus" setting lives here too: a class only when it is off,
// rule in src/platform/menu-title.css. Values go through `normalizeSettings`, so nothing from `data.json`
// reaches CSS raw: only known classes and a validated integer with `%`. Without `document` (windowless test
// suites) this does nothing and does not throw: an error after a write would land in the settings page's
// `.catch` and report "data.json not saved".
import { normalizeSettings } from '../core/settings/settings.ts';

export const TREE_LINES_GREY = 'buba-tree-lines-grey';
export const TREE_LINES_COLOR = 'buba-tree-lines-color';
export const TREE_ARROW_COLOR = 'buba-tree-arrow-color';
export const TREE_NAME_FOLDER = 'buba-tree-name-folder';
export const TREE_NAME_TAG = 'buba-tree-name-tag';
/** The "Buba label in menus" setting is off; no class by default. */
export const MENU_OWN_OFF = 'buba-menu-own-off';
/** All look classes; the "Off" guide lines option has no class. */
export const TREE_LOOK_CLASSES = [
  TREE_LINES_GREY,
  TREE_LINES_COLOR,
  TREE_ARROW_COLOR,
  TREE_NAME_FOLDER,
  TREE_NAME_TAG,
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
  body.toggleClass(TREE_ARROW_COLOR, look.treeArrowColor);
  body.toggleClass(TREE_NAME_FOLDER, look.treeFolderNameColor);
  body.toggleClass(TREE_NAME_TAG, look.treeTagNameColor);
  body.toggleClass(MENU_OWN_OFF, !look.menuOwnLabel);
  body.setCssProps({ [TREE_GUIDE_ALPHA]: `${look.treeLinesOpacity}%` });
}

/** On plugin unload: removes the classes and the variable. */
export function clearTreeLook(body: HTMLElement | null = mainBody()): void {
  if (!body) return;
  body.removeClass(...TREE_LOOK_CLASSES);
  body.setCssProps({ [TREE_GUIDE_ALPHA]: '' });
}
