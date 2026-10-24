// Per-place grid look, without Obsidian: a place (a folder, "All files" or another module's source) remembers
// eight look fields; a place without its own look uses the common one. The record is kept in the device's
// local storage (src/assets/grid/place-views.ts) as is: unknown fields of the record and of a look survive
// rewrites, field validity is checked when a look is read, and a place value that is not a look reads as
// "none of its own" and stays on write. A place's look is found by key, without scanning places. Write
// functions return the same record if nothing changed.
import { normalizeGridViewState, type GridSourceState, type GridViewState } from './view-state.ts';

/** Record key in the device's local storage: Obsidian prefixes it with the vault id. */
export const PLACE_VIEWS_KEY = 'buba-grid-views';
export const PLACE_VIEWS_SCHEMA = 1;

/**
 * What a place remembers: sort and direction, "Then by" and its direction (a record without them reads as
 * "None"), layout, fit, tile size and names under tiles.
 */
export const LOOK_FIELDS = [
  'sort',
  'dir',
  'thenSort',
  'thenDir',
  'layout',
  'fit',
  'size',
  'showNames',
] as const;
export type PlaceLook = Pick<GridViewState, (typeof LOOK_FIELDS)[number]>;

/**
 * The stored record as is: `schema`, `common` (the common look), `places` (own looks by place
 * key), and unknown fields.
 */
export type PlaceViews = Readonly<Record<string, unknown>>;

type Entry = Readonly<Record<string, unknown>>;

const isEntry = (value: unknown): value is Entry =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A look from anything, via the grid state reader: a broken field gets its default. */
export function lookOf(raw: unknown): PlaceLook {
  const state = normalizeGridViewState(raw);
  return {
    sort: state.sort,
    dir: state.dir,
    thenSort: state.thenSort,
    thenDir: state.thenDir,
    layout: state.layout,
    fit: state.fit,
    size: state.size,
    showNames: state.showNames,
  };
}

/** Default look: used as the common one until a common look is remembered. */
export const DEFAULT_LOOK: PlaceLook = lookOf(undefined);

export function sameLook(a: PlaceLook, b: PlaceLook): boolean {
  return LOOK_FIELDS.every((field) => a[field] === b[field]);
}

/** The state carries a look if it has at least one look field; a new tab's `{}` is empty. */
export function hasLook(raw: unknown): boolean {
  return isEntry(raw) && LOOK_FIELDS.some((field) => Object.hasOwn(raw, field));
}

/** An object with fields sorted by name; anything else as is. */
function byName(value: unknown): unknown {
  if (!isEntry(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Place key from what the grid shows: `folder:<path>` (root is `folder:/`; "include subfolders" is the same
 * folder), `all` for "All files", `source:<source fields by name>` for a tag, "Untagged" or a group. Source
 * data is taken as is, case-sensitive: "Photo" and "photo" are two places.
 */
export function placeKey(source: GridSourceState | { readonly kind: string }): string {
  if (source.kind === 'all') return 'all';
  const { path } = source as { path?: unknown };
  if (source.kind === 'folder' && typeof path === 'string') return folderKey(path);
  return `source:${JSON.stringify(source, (_key, value: unknown) => byName(value))}`;
}

const folderKey = (path: string): string => `folder:${path}`;

/** Record from local storage: an object as is; anything else or broken is an empty record. */
export function readPlaceViews(raw: unknown): PlaceViews {
  return isEntry(raw) ? raw : {};
}

/**
 * The record's places as stored, including values that are not looks; `places` that is not an
 * object means no places.
 */
function placesOf(views: PlaceViews): Entry {
  return isEntry(views.places) ? views.places : {};
}

/** A place's own look by key, as stored; `null` if missing or not a look. */
function entryAt(views: PlaceViews, key: string): Entry | null {
  const places = placesOf(views);
  if (!Object.hasOwn(places, key)) return null;
  const entry = places[key];
  return isEntry(entry) ? entry : null;
}

/** The entry has only look fields, nothing unknown, so it can be dropped once it equals the common look. */
const plain = (entry: Entry): boolean =>
  Object.keys(entry).every((field) => (LOOK_FIELDS as readonly string[]).includes(field));

function withPlaces(views: PlaceViews, places: Entry): PlaceViews {
  return { ...views, schema: PLACE_VIEWS_SCHEMA, places };
}

function without(places: Entry, key: string): Entry {
  const { [key]: _gone, ...rest } = places;
  return rest;
}

/** The common look; `null` if none was remembered yet. */
export function commonLook(views: PlaceViews): PlaceLook | null {
  return isEntry(views.common) ? lookOf(views.common) : null;
}

/** The place's own look; `null` if it has none. */
export function ownLook(views: PlaceViews, key: string): PlaceLook | null {
  const entry = entryAt(views, key);
  return entry ? lookOf(entry) : null;
}

/** A place's look: its own, else the common one, else the default. Parent folders pass nothing down. */
export function lookFor(views: PlaceViews, key: string): PlaceLook {
  return ownLook(views, key) ?? commonLook(views) ?? DEFAULT_LOOK;
}

/** The look differs from the common one, so the place has its own. */
export function differsFromCommon(views: PlaceViews, look: PlaceLook): boolean {
  return !sameLook(look, commonLook(views) ?? DEFAULT_LOOK);
}

/**
 * The look of a place changed: the place remembers it; if it equals the common look, the place has none of
 * its own. Unknown fields of the place's previous entry are kept, and then the entry is not dropped.
 */
export function remember(views: PlaceViews, key: string, look: PlaceLook): PlaceViews {
  const prev = entryAt(views, key);
  if (!differsFromCommon(views, look) && (!prev || plain(prev))) {
    return prev ? withPlaces(views, without(placesOf(views), key)) : views;
  }
  if (prev && sameLook(lookOf(prev), look)) return views;
  return withPlaces(views, { ...placesOf(views), [key]: { ...prev, ...look } });
}

/** "Reset to default view": the place no longer has its own look. */
export function forget(views: PlaceViews, key: string): PlaceViews {
  return entryAt(views, key) ? withPlaces(views, without(placesOf(views), key)) : views;
}

/**
 * "Make this the default view": the place's look becomes common and the place has none of its own; own looks
 * equal to the new common one are dropped, so those places follow the common look from now on.
 */
export function makeCommon(views: PlaceViews, key: string, look: PlaceLook): PlaceViews {
  const common: Entry = { ...(isEntry(views.common) ? views.common : {}), ...entryAt(views, key), ...look };
  const kept = Object.entries(placesOf(views)).filter(
    ([at, entry]) => at !== key && !(isEntry(entry) && plain(entry) && sameLook(lookOf(entry), look)),
  );
  return { ...views, schema: PLACE_VIEWS_SCHEMA, common, places: Object.fromEntries(kept) };
}

/**
 * First run, before any record exists: the looks of the open tabs are spread over their places. The first
 * non-empty state becomes common if there is no common look; for the rest, a look that differs from common
 * becomes the place's own; a second tab of the same place and a place that already has a look are left as is.
 */
export function seed(views: PlaceViews, tabs: readonly { key: string; state: unknown }[]): PlaceViews {
  let next = views;
  const seen = new Set<string>();
  for (const { key, state } of tabs) {
    if (!hasLook(state) || seen.has(key)) continue;
    seen.add(key);
    const look = lookOf(state);
    if (commonLook(next) === null) {
      next = withPlaces({ ...next, common: look }, placesOf(next));
      continue;
    }
    if (ownLook(next, key) === null) next = remember(next, key, look);
  }
  return next;
}

/**
 * Folder `from` was renamed or moved to `to`: the own look of exactly `from` moves to `to`; if there is none,
 * an old entry under `to` is dropped too, so the look of a long-deleted folder does not stick to the new one.
 * Nested folders move with their own `rename` events, since Obsidian sends one for each.
 */
export function movePlace(views: PlaceViews, from: string, to: string): PlaceViews {
  if (from === to) return views;
  const places = placesOf(views);
  const [was, now] = [folderKey(from), folderKey(to)];
  if (Object.hasOwn(places, was)) return withPlaces(views, { ...without(places, was), [now]: places[was] });
  return Object.hasOwn(places, now) ? withPlaces(views, without(places, now)) : views;
}
