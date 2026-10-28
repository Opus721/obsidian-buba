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
/**
 * A folder tile in the grid (a back plate and a glass front): one picture standing in it as the cover (the
 * folder's own cover, else one of its files; word of the owner 27.10), a few of its files lying inside, which
 * come out on hover, or none. Kept as `peek` and `solid` so a saved choice keeps its meaning.
 */
export const FOLDER_TILES = ['one', 'peek', 'solid'] as const;
export type FolderTile = (typeof FOLDER_TILES)[number];
/** Where a folder tile shows its cover: on the back plate under the glass front, or on the front. */
export const FOLDER_COVERS = ['back', 'front'] as const;
export type FolderCover = (typeof FOLDER_COVERS)[number];
/**
 * Whether a folder tile shows its cover on the front: with files inside always, since a cover behind them
 * looks cluttered (word of the owner 27.10); without files as "Folder cover" says; never with one picture,
 * which is the cover itself.
 */
export const coverInFront = (settings: Pick<BubaSettings, 'folderTile' | 'folderCover'>): boolean =>
  settings.folderTile === 'peek' || (settings.folderTile === 'solid' && settings.folderCover === 'front');
/** The back plate of a folder tile with the cover in front: theme grey, or the cover's average color. */
export const FOLDER_PLATES = ['grey', 'cover'] as const;
export type FolderPlate = (typeof FOLDER_PLATES)[number];
/**
 * How a selected folder tile is marked: a line around its front, tipping with it; the whole tile area tinted;
 * or the area tinted with an accent frame (word of the owner 26.10).
 */
export const FOLDER_SELECTS = ['front', 'fill', 'frame'] as const;
export type FolderSelect = (typeof FOLDER_SELECTS)[number];
/**
 * How a file without a picture (PSD and AI without a thumbnail, AEP, ZIP…) looks in the grid: a document
 * silhouette on the whole tile, a square with the type and the app plaque, or a small silhouette.
 */
export const FILE_TILES = ['shape', 'plate', 'small'] as const;
export type FileTile = (typeof FILE_TILES)[number];
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
  /**
   * Arrows after the name, showing whether a folder or tag group is open; a press on the icon opens and
   * closes it, the arrow is not pressed (src/platform/tree-press.ts).
   */
  treeArrows: boolean;
  /** Expand arrows in the folder color, for folders and tag groups with a color. */
  treeArrowColor: boolean;
  /** Folder name in the icon color. */
  treeFolderNameColor: boolean;
  /** Tag name in the dot color, and group name in its icon color. */
  treeTagNameColor: boolean;
  /**
   * Long folder and tag names in the Buba trees on one line, cut with "…", the whole name in Obsidian's hover
   * tooltip; when off, a long name wraps onto more lines, as in Obsidian's file explorer.
   */
  treeNameOneLine: boolean;
  /** Folder tile in the grid: one picture as the cover (default), a few files inside, or none. */
  folderTile: FolderTile;
  /** Cover of a folder tile: on the back plate under glass (default) or on the front. */
  folderCover: FolderCover;
  /** Back plate behind a cover in front: the cover's average color (default) or theme grey. */
  folderPlate: FolderPlate;
  /**
   * A folder tile without its own cover shows the folder's newest picture; off (default), it is the empty
   * folder in its color, and only a cover set by hand shows.
   */
  folderAutoCover: boolean;
  folderSelect: FolderSelect;
  /** File without a picture in the grid: a whole-tile silhouette (default), a square plate, a small silhouette. */
  fileTile: FileTile;
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
  // Tree look defaults: nesting lines in the folder's color, folder and tag names take their color, the arrows
  // after the name are on and grey (word of the owner 27.10, lines 18:46).
  treeLines: 'color',
  treeLinesOpacity: 40,
  treeArrows: true,
  treeArrowColor: false,
  treeFolderNameColor: true,
  treeTagNameColor: true,
  // One line by default: the owner finds wrapped names tiring (25.10).
  treeNameOneLine: true,
  // One picture stands in the folder as its cover, more on hover; a few files inside and a closed folder are
  // the other choices (word of the owner 27.10 18:16).
  folderTile: 'one',
  // The cover on the front; behind, under glass, is the other choice (word of the owner 26.10).
  folderCover: 'front',
  // The plate takes the cover's color; theme grey is the other choice (word of the owner 25.10).
  folderPlate: 'cover',
  // Only a cover set by hand; the newest picture is the other choice (word of the owner 27.10).
  folderAutoCover: false,
  // The tile area tinted; a line around the front and the framed area are the other choices (word of the owner 26.10).
  folderSelect: 'fill',
  // Programs differ by silhouette, like in a file manager (word of the owner 25.10).
  fileTile: 'shape',
  // The "Buba" menu label is visible by default.
  menuOwnLabel: true,
  // Day first and 24-hour time; a data.json without these keys gets the same.
  ...DEFAULT_DATE_LOOK,
});

/**
 * Keys of "Appearance" (Settings → Buba): its own reset puts back only these, the rest of the page stays (word
 * of the owner 27.10 18:46).
 */
export const LOOK_KEYS = [
  'treeLines',
  'treeLinesOpacity',
  'treeArrows',
  'treeArrowColor',
  'treeFolderNameColor',
  'treeTagNameColor',
  'treeNameOneLine',
  'folderTile',
  'folderCover',
  'folderPlate',
  'folderAutoCover',
  'folderSelect',
  'fileTile',
  'menuOwnLabel',
] as const satisfies readonly (keyof BubaSettings)[];

/** Defaults of the "Appearance" keys only. */
export const lookDefaults = (): Partial<BubaSettings> =>
  Object.fromEntries(LOOK_KEYS.map((key) => [key, DEFAULT_SETTINGS[key]]));

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
    treeArrows: bool(data.treeArrows, DEFAULT_SETTINGS.treeArrows),
    treeArrowColor: bool(data.treeArrowColor, DEFAULT_SETTINGS.treeArrowColor),
    treeFolderNameColor: bool(data.treeFolderNameColor, DEFAULT_SETTINGS.treeFolderNameColor),
    treeTagNameColor: bool(data.treeTagNameColor, DEFAULT_SETTINGS.treeTagNameColor),
    treeNameOneLine: bool(data.treeNameOneLine, DEFAULT_SETTINGS.treeNameOneLine),
    folderTile: oneOf(FOLDER_TILES, data.folderTile, DEFAULT_SETTINGS.folderTile),
    folderCover: oneOf(FOLDER_COVERS, data.folderCover, DEFAULT_SETTINGS.folderCover),
    folderPlate: oneOf(FOLDER_PLATES, data.folderPlate, DEFAULT_SETTINGS.folderPlate),
    folderAutoCover: bool(data.folderAutoCover, DEFAULT_SETTINGS.folderAutoCover),
    folderSelect: oneOf(FOLDER_SELECTS, data.folderSelect, DEFAULT_SETTINGS.folderSelect),
    fileTile: oneOf(FILE_TILES, data.fileTile, DEFAULT_SETTINGS.fileTile),
    menuOwnLabel: bool(data.menuOwnLabel, DEFAULT_SETTINGS.menuOwnLabel),
    dateFormat: oneOf(DATE_FORMATS, data.dateFormat, DEFAULT_SETTINGS.dateFormat),
    timeFormat: oneOf(TIME_FORMATS, data.timeFormat, DEFAULT_SETTINGS.timeFormat),
  };
}
