// File type filter of the grid: keeps only files of the checked types. A type is the file
// extension, lowercase, without the dot, like the format badge on a tile
// (`FileRecord.ext`); a file without an extension has the empty type. No Obsidian here:
// the grid view (src/assets/grid/view.ts) holds the selection, type-filter.ts the window.
import { t } from '../i18n/dict/grid.ts';

/** A file as the filter sees it, an index record: only the extension matters. */
export interface TypedFile {
  readonly ext: string;
}

/** A type and how many files of it are in the open place. */
export interface TypeCount {
  readonly type: string;
  readonly count: number;
}

/** What the filter kept: paths of files of the selected types in source order, and the total in the place. */
export interface TypeTally {
  readonly paths: string[];
  readonly total: number;
}

/**
 * Caption above the grid in three parts: `names` are the selected types ("PSD"), long ones shrink with an
 * ellipsis on a narrow screen; `tally` is " · 12 of 340" and always visible; `tail` explains an empty result
 * (" — no files of this type") and is truncated first, so its meaning goes at its start: a "no" at the end
 * got eaten by the ellipsis and the caption read the opposite way. `tail` is empty when something is shown.
 */
export interface TypeCaption {
  readonly names: string;
  readonly tally: string;
  readonly tail: string;
}

/** One filter render: place, selection, shown and total; comparing two reveals newly hidden files. */
export interface TypeShown {
  readonly place: string;
  readonly types: string;
  readonly shown: number;
  readonly total: number;
}

/** Type labels in the caption above the grid; the rest is shown as "+N". */
const NAMES_SHOWN = 3;

const collator = new Intl.Collator(undefined, { numeric: true });

/** Type label: the extension in uppercase, like the format badge; a word for files without an extension. */
export function typeLabel(type: string): string {
  return type === '' ? t('noExtension') : type.toUpperCase();
}

/** Types sorted by label with numbers by value ("MP3" before "MP4"); "No extension" goes last. */
export function compareTypes(a: string, b: string): number {
  if (a === '' || b === '') return Number(a === '') - Number(b === '');
  return collator.compare(typeLabel(a), typeLabel(b));
}

/**
 * Types whose label contains the query, case-insensitive: the "Find type" field of the
 * window, like tag search (`matchTags`) and Obsidian's `prepareSimpleSearch`, not fuzzy
 * search: "ps" keeps PSD and PSB, not any "P…S". Surrounding spaces and a leading dot
 * are ignored, so ".psd" works like "psd". An empty query keeps all, in the same order.
 */
export function matchTypes(types: readonly string[], query: string): string[] {
  const key = query.trim().replace(/^\.+/, '').toLowerCase();
  return key === '' ? [...types] : types.filter((type) => typeLabel(type).toLowerCase().includes(key));
}

/**
 * The selection as one string to compare two selections: the same types in any order give the same string.
 */
export function typesKey(selected: ReadonlySet<string>): string {
  return JSON.stringify([...selected].sort(compareTypes));
}

/**
 * Filters the place's files by the selection in one pass, by the same rule
 * as the grid (`gridItems`): a path without a record is not a file of the
 * place, a repeated path is one file. An empty selection keeps all types.
 */
export function filterByType(
  paths: readonly string[],
  byPath: ReadonlyMap<string, TypedFile>,
  selected: ReadonlySet<string>,
): TypeTally {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const path of paths) {
    const file = byPath.get(path);
    if (!file || seen.has(path)) continue;
    seen.add(path);
    if (selected.size === 0 || selected.has(file.ext)) kept.push(path);
  }
  return { paths: kept, total: seen.size };
}

/**
 * Types of the place with file counts, in one pass, by the same rule as the filter. A selected type absent
 * from the place gets zero, so the window still lets the user uncheck it. Sorted by `compareTypes`.
 */
export function countTypes(
  paths: readonly string[],
  byPath: ReadonlyMap<string, TypedFile>,
  selected: ReadonlySet<string>,
): TypeCount[] {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const type of selected) counts.set(type, 0);
  for (const path of paths) {
    const file = byPath.get(path);
    if (!file || seen.has(path)) continue;
    seen.add(path);
    counts.set(file.ext, (counts.get(file.ext) ?? 0) + 1);
  }
  return [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => compareTypes(a.type, b.type));
}

/**
 * Caption above the grid with the filter on: "PSD · 12 of 340" gives the
 * selected types, how many files are shown and how many the place has. More
 * than three types: "PSD, JPG, PNG +2". If nothing is shown, it says so.
 */
export function typeCaption(selected: ReadonlySet<string>, shown: number, total: number): TypeCaption {
  const labels = [...selected].sort(compareTypes).map(typeLabel);
  const names =
    labels.length > NAMES_SHOWN
      ? `${labels.slice(0, NAMES_SHOWN).join(', ')} +${labels.length - NAMES_SHOWN}`
      : labels.join(', ');
  const tally = t('typeTally', { shown, total });
  if (shown > 0) return { names, tally, tail: '' };
  // One type or several picks one of two phrases, not a plural form: the explanation has no number.
  return { names, tally, tail: t(labels.length === 1 ? 'noFilesOfType' : 'noFilesOfTypes') };
}

/**
 * How many new files of the place the filter hid since the last render: same place and selection, more files
 * and more hidden ones. Another place, another selection or the first render with the filter gives 0.
 */
export function newlyHidden(prev: TypeShown | null, next: TypeShown): number {
  if (!prev || prev.place !== next.place || prev.types !== next.types) return 0;
  const added = next.total - prev.total;
  const hidden = next.total - next.shown - (prev.total - prev.shown);
  return Math.max(0, Math.min(added, hidden));
}
