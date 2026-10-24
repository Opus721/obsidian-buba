// Workspace events between the file panel (src/assets) and modules outside it. Modules do not import each
// other, so the names and the section shape live here in core, like `FILE_PANEL` of the viewer
// (src/core/viewer/edge.ts). Sent with `app.workspace.trigger` and received with `(workspace as Events).on`,
// since Obsidian's types do not know plugin events. Values never change. No `obsidian` import.

/**
 * The panel asks modules for their sections once the layout is ready. Data: `add(section)`, which returns the
 * undo. Sent by the panel module, received by modules with a section.
 */
export const INSPECTOR_SECTIONS = 'buba:inspector-sections';

/**
 * A module asks for `add` after it starts listening to `INSPECTOR_SECTIONS`: when the plugin is enabled or
 * updated with the layout already ready, the panel's call went out before a later module listened. Data: the
 * module's receiver, which the panel calls with `add` once the layout is ready (before that, the panel's own
 * `INSPECTOR_SECTIONS` reaches it). Sent by modules with a section, received by the panel module.
 */
export const INSPECTOR_SECTIONS_ASK = 'buba:inspector-sections-ask';

/**
 * Open files the way the grid opens them. Data: vault paths, the index of the one to show, and `newTab`.
 * Images and video open in the Buba viewer, which pages through the listed ones; notes, PDFs and audio open
 * in Obsidian; `newTab` opens the file in a new tab. Received by the assets module.
 */
export const VIEW_FILES = 'buba:view-files';

/** Show a file in its folder in the Buba grid, selected. Data: the vault path. Received by the assets module. */
export const SHOW_IN_FOLDER = 'buba:show-in-folder';

/** Show a file's folder in the Buba folder tree. Data: the vault path. Received by the assets module. */
export const REVEAL_IN_TREE = 'buba:reveal-in-tree';

/**
 * Show a file in the file panel and scroll to one of its sections. Data: the vault path and the section id.
 * Received by the panel module.
 */
export const SHOW_PANEL = 'buba:show-panel';

/** Ids of the generation module's sections, for `SHOW_PANEL`: "Generation" and "Used in generations". */
export const GENERATION_SECTION = 'buba-generation';
export const USED_SECTION = 'buba-generation-used';

/** A file panel section; a module outside the panel adds it through `INSPECTOR_SECTIONS`. */
export interface PanelSection {
  id: string;
  /**
   * Preview 10, file fields 20, resolution 25, tags 30, rating 40, link 45, generation 47, used in
   * generations 48, comments 50, boards 55; other modules from 60.
   */
  order: number;
  /** Draws the section for the shown files; returns a cleanup run before the next draw and on close. */
  render(el: HTMLElement, paths: string[]): (() => void) | void;
}
