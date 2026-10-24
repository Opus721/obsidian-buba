// Buba settings: `data.json` in the plugin folder (`Plugin.loadData` / `saveData`,
// Settings → Buba), without the `obsidian` import. The schema number and unknown keys
// are preserved, so an older build reads and rewrites a newer build's `data.json`
// without loss. Builds before settings ignore `data.json`, so a rollback is safe.
import {
  DATE_FORMATS,
  DEFAULT_DATE_LOOK,
  TIME_FORMATS,
  type DateFormat,
  type TimeFormat,
} from '../inspector/date.ts';

/** Nesting lines of Buba trees: off, grey (Obsidian's line) or in the parent folder's color. */
export const TREE_LINES = ['off', 'grey', 'color'] as const;
export type TreeLines = (typeof TREE_LINES)[number];

/** Opacity of colored lines, %: slider limits and step; other values in `data.json` mean the default. */
export const TREE_LINES_OPACITY = { min: 10, max: 100, step: 5 } as const;

export interface BubaSettings {
  schema: number;
  /** Grid keys: T, 1–5, space and undo in the grid body; when off, the key goes to Obsidian's hotkeys. */
  gridKeys: boolean;
  /**
   * Reveal the open folder in the tree: when the grid opens a folder, the Buba
   * tree expands its parents and scrolls to it, like "Auto-reveal current
   * file" of Obsidian's file explorer; when off, the tree stays as it was.
   */
  autoRevealFolder: boolean;
  /** Nesting lines, shared by the folder and tag trees. */
  treeLines: TreeLines;
  /** Opacity of colored lines, %, only for lines in the folder color. */
  treeLinesOpacity: number;
  /** Expand arrows in the folder color, for folders and tag groups with a color. */
  treeArrowColor: boolean;
  /** Folder name in the icon color. */
  treeFolderNameColor: boolean;
  /** Tag name in the dot color, and group name in its icon color. */
  treeTagNameColor: boolean;
  /**
   * "Buba" label in menus: the word "Buba" on the right of Buba's own file and folder menu items. When off,
   * the class `buba-menu-own-off` is set on `body` (src/platform/tree-look.ts).
   */
  menuOwnLabel: boolean;
  /** Date format: day or month first, in all Buba dates, whatever the Obsidian language. */
  dateFormat: DateFormat;
  /** Time format: 24 or 12 hours. */
  timeFormat: TimeFormat;
  [key: string]: unknown;
}

export const SETTINGS_SCHEMA = 1;
export const DEFAULT_SETTINGS: Readonly<BubaSettings> = Object.freeze({
  schema: SETTINGS_SCHEMA,
  gridKeys: true,
  // Reveal is on by default. A saved `false` is kept: it cannot be told apart from a deliberate choice.
  autoRevealFolder: true,
  // Tree look defaults; folder and tag names use the normal text color.
  treeLines: 'off',
  treeLinesOpacity: 40,
  treeArrowColor: true,
  treeFolderNameColor: false,
  treeTagNameColor: false,
  // The "Buba" menu label is visible by default.
  menuOwnLabel: true,
  // Day first and 24-hour time; a data.json without these keys gets the same.
  ...DEFAULT_DATE_LOOK,
});

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  (list as readonly unknown[]).includes(value) ? (value as T) : fallback;

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

const isOpacity = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value % TREE_LINES_OPACITY.step === 0 &&
  value >= TREE_LINES_OPACITY.min &&
  value <= TREE_LINES_OPACITY.max;

/**
 * `loadData()` result to settings. No file (`null`), broken JSON (Obsidian
 * returns `undefined`) or a non-object gives the defaults; a field of the
 * wrong type gets its default; unknown keys and a newer schema are kept.
 */
export function normalizeSettings(raw: unknown): BubaSettings {
  const data =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const schema = data.schema;
  return {
    ...data,
    schema:
      typeof schema === 'number' && Number.isInteger(schema) && schema > SETTINGS_SCHEMA
        ? schema
        : SETTINGS_SCHEMA,
    gridKeys: bool(data.gridKeys, DEFAULT_SETTINGS.gridKeys),
    autoRevealFolder: bool(data.autoRevealFolder, DEFAULT_SETTINGS.autoRevealFolder),
    treeLines: (TREE_LINES as readonly unknown[]).includes(data.treeLines)
      ? (data.treeLines as TreeLines)
      : DEFAULT_SETTINGS.treeLines,
    treeLinesOpacity: isOpacity(data.treeLinesOpacity)
      ? data.treeLinesOpacity
      : DEFAULT_SETTINGS.treeLinesOpacity,
    treeArrowColor: bool(data.treeArrowColor, DEFAULT_SETTINGS.treeArrowColor),
    treeFolderNameColor: bool(data.treeFolderNameColor, DEFAULT_SETTINGS.treeFolderNameColor),
    treeTagNameColor: bool(data.treeTagNameColor, DEFAULT_SETTINGS.treeTagNameColor),
    menuOwnLabel: bool(data.menuOwnLabel, DEFAULT_SETTINGS.menuOwnLabel),
    dateFormat: oneOf(DATE_FORMATS, data.dateFormat, DEFAULT_SETTINGS.dateFormat),
    timeFormat: oneOf(TIME_FORMATS, data.timeFormat, DEFAULT_SETTINGS.timeFormat),
  };
}
