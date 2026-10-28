// Grid view state: which folder is open and how it is shown. The view keeps it in the Obsidian leaf state
// (getState/setState), so a state saved in the layout is only read through normalizeGridViewState.

/**
 * Grid view type, in one place for the assets and the commands modules (other modules may not
 * import `src/assets`).
 */
export const GRID_VIEW_TYPE = 'buba-grid';

/** Tile size, px: slider 80-400, default 160. */
export const TILE_SIZE_MIN = 80;
export const TILE_SIZE_MAX = 400;
export const TILE_SIZE_DEFAULT = 160;

const DIRS = ['asc', 'desc'] as const;
const LAYOUTS = ['uniform', 'justified', 'waterfall'] as const;
const FITS = ['contain', 'cover'] as const;

/** A source registered by another module (`tag`, `untagged`): plain data, as the module gave it. */
export interface GridSourceState {
  readonly kind: string;
  readonly [key: string]: unknown;
}

export interface GridViewState {
  /** `null` is "All files", `'/'` the vault root, otherwise a folder path. */
  folder: string | null;
  /** Include subfolders. */
  deep: boolean;
  /** Id from the sort registry; `created` is the date added (the creation date for ordinary files). */
  sort: string;
  dir: (typeof DIRS)[number];
  /**
   * "Then by", the second sort level: an id from the registry, applied within items equal by `sort`;
   * `'none'` is "None". Flat fields next to `sort`/`dir` rather than a list of levels: older builds drop
   * unknown state fields.
   */
  thenSort: string;
  thenDir: (typeof DIRS)[number];
  /**
   * `uniform` is "Grid", an even grid; `justified` is "Justified"; `waterfall` is "Columns". Older builds
   * read an unknown value as the default, so they show `waterfall` as justified.
   */
  layout: (typeof LAYOUTS)[number];
  /** `contain` fits the whole image, `cover` fills the tile. */
  fit: (typeof FITS)[number];
  /** Tile size, px: TILE_SIZE_MIN…TILE_SIZE_MAX. */
  size: number;
  /** Name under the tile. */
  showNames: boolean;
  /** Another module's source instead of a folder; without it the folder from `folder` and `deep` is shown. */
  source?: GridSourceState;
}

const DEFAULTS: GridViewState = {
  folder: null,
  deep: false,
  sort: 'created',
  dir: 'desc',
  thenSort: 'none',
  thenDir: 'desc',
  layout: 'justified',
  fit: 'contain',
  size: TILE_SIZE_DEFAULT,
  showNames: true,
};

/**
 * The direction a sort key starts with, as in the Obsidian file explorer sort: name goes A to Z, the
 * rest (dates, size, rating, unknown registry keys) descending. Type goes ascending like name, so
 * program files come first.
 */
function naturalDir(sort: string): GridViewState['dir'] {
  return sort === 'name' || sort === 'type' ? 'asc' : 'desc';
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((item) => item === value) ?? fallback;
}

/** An object with a non-empty string `kind` as is; anything else is not a source. */
function sourceOf(value: unknown): GridSourceState | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { kind } = value as { kind?: unknown };
  return typeof kind === 'string' && kind !== '' ? (value as GridSourceState) : undefined;
}

/**
 * State from anything: unknown and broken values get defaults, size is clamped to 80-400; `source` only if
 * valid, otherwise the field is absent.
 */
export function normalizeGridViewState(raw: unknown): GridViewState {
  const state: Record<string, unknown> =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...raw } : {};
  const { folder, deep, sort, dir, thenSort, thenDir, layout, fit, size, showNames } = state;
  const source = sourceOf(state.source);
  return {
    folder: typeof folder === 'string' && folder !== '' ? folder : DEFAULTS.folder,
    deep: typeof deep === 'boolean' ? deep : DEFAULTS.deep,
    sort: typeof sort === 'string' && sort !== '' ? sort : DEFAULTS.sort,
    dir: oneOf(dir, DIRS, DEFAULTS.dir),
    thenSort: typeof thenSort === 'string' && thenSort !== '' ? thenSort : DEFAULTS.thenSort,
    thenDir: oneOf(thenDir, DIRS, DEFAULTS.thenDir),
    layout: oneOf(layout, LAYOUTS, DEFAULTS.layout),
    fit: oneOf(fit, FITS, DEFAULTS.fit),
    size:
      typeof size === 'number' && Number.isFinite(size)
        ? Math.min(TILE_SIZE_MAX, Math.max(TILE_SIZE_MIN, size))
        : DEFAULTS.size,
    showNames: typeof showNames === 'boolean' ? showNames : DEFAULTS.showNames,
    ...(source && { source }),
  };
}

/**
 * What the grid shows, as a string: folder, "include subfolders" and source from the state, as the view reads
 * it. The look (sort, direction, size, layout, fit, names) is not content, so the file panel keeps what it
 * shows when only the look changes. Source fields are sorted by name at any depth: one source built in
 * different ways gives one key, just as a history step compares sources regardless of field order
 * (`sameSource`, src/assets/grid/navigation.ts).
 */
export function gridContentKey(state: unknown): string {
  const { folder, deep, source } = normalizeGridViewState(state);
  return JSON.stringify([folder, deep, source ?? null], (_key, value: unknown) => byName(value));
}

/** An object with fields sorted by name; anything else as is. */
function byName(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const fields = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(fields);
}

/**
 * State after a partial change. A patch with `folder` and no `source` (going to a folder or "All files")
 * drops another module's source; a patch with `source` keeps the folder, which the grid returns to if the
 * source's view is not registered. A patch with a different sort key and no `dir` sets the key's natural
 * direction; a `dir` in the patch is taken as given, and the same key keeps its direction; the second level
 * (`thenSort`, `thenDir`) follows the same rule, and a second level on the main key is dropped: sorting twice
 * by one key orders nothing more. Everything else comes from the previous state.
 */
export function nextGridState(prev: unknown, patch: Readonly<Record<string, unknown>>): GridViewState {
  const next: Record<string, unknown> = {
    ...(typeof prev === 'object' && prev !== null && !Array.isArray(prev) ? prev : {}),
    ...patch,
  };
  if ('folder' in patch && !('source' in patch)) delete next.source;
  const state = normalizeGridViewState(next);
  if ('sort' in patch && !('dir' in patch) && state.sort !== normalizeGridViewState(prev).sort) {
    state.dir = naturalDir(state.sort);
  }
  const prevThen = normalizeGridViewState(prev).thenSort;
  if ('thenSort' in patch && !('thenDir' in patch) && state.thenSort !== prevThen) {
    state.thenDir = naturalDir(state.thenSort);
  }
  if (state.thenSort === state.sort) state.thenSort = DEFAULTS.thenSort;
  return state;
}

/**
 * Path after renaming or moving `from` to `to`: `from` and everything under `from/` moves under `to`; a
 * name-prefix sibling ("Tags-old" for "Tags") and anything else stays. One rule for the grid, expanded tree
 * folders and the selection.
 */
export function movedPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
}

/**
 * State after Obsidian renames folder `from` to `to`: only `folder` changes, `source` and the look stay;
 * "All files", the root and an unaffected folder return the same object. Not via `nextGridState`, which
 * would drop `source`.
 */
export function renameGridFolder(state: GridViewState, from: string, to: string): GridViewState {
  const { folder } = state;
  if (folder === null || folder === '/') return state;
  const moved = movedPath(folder, from, to);
  return moved === folder ? state : { ...state, folder: moved };
}

/**
 * State after folder `deleted` is deleted from the Buba tree: if the open folder is it or inside it, the grid
 * goes to the deleted folder's parent, the way Eagle leaves a deleted folder; `source` and the look stay. "All
 * files", the root and an unaffected folder return the same object.
 */
export function deleteGridFolder(state: GridViewState, deleted: string): GridViewState {
  const { folder } = state;
  if (folder === null || folder === '/') return state;
  if (folder !== deleted && !folder.startsWith(`${deleted}/`)) return state;
  const at = deleted.lastIndexOf('/');
  return { ...state, folder: at < 0 ? '/' : deleted.slice(0, at) };
}

/**
 * A history step's folder under its current name: as is if it exists; otherwise it is carried through
 * the `[from, to]` renames in order, the way `FileView.onRename` follows an open file. "All files" and
 * the root stay as is.
 */
export function followRenames(
  folder: string | null,
  renames: readonly (readonly [string, string])[],
  exists: (path: string) => boolean,
): string | null {
  if (folder === null || folder === '/' || exists(folder)) return folder;
  let path = folder;
  for (const [from, to] of renames) path = movedPath(path, from, to);
  return path;
}
