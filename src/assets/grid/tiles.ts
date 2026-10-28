// The grid body: only visible rows are drawn as tiles, with @tanstack/virtual-core and no framework. The unit
// is a grid row: uniform rows share one height (uniformGrid), justified rows take heights from the core
// layout (justifiedRows), and columns use body strips at the uniform row pitch while each tile's place comes
// from the core layout (waterfall). Tile elements are not recreated: a tile leaving the view takes the path
// of one arriving, the same tile in a new place keeps its element, and an element waiting in the pool is not
// a tile: no class, path, marks, preview or original. Markup for other modules: a visible tile has the
// `buba-tile` class and `data-path`, a subfolder tile has the folder path. A tile shows the preview from the
// device preview store, until then an icon by file type; a file whose preview is neither an image nor a video
// frame (PSD and AI while there is no thumbnail or the file has none; AEP, ZIP… always) also gets a format
// label under the icon in its family color (src/core/format/family.ts), and such a tile has no corner badge,
// only the label (tiles.css). The original is never put into a tile, except video and GIF on hover on
// desktop, one per grid. Visible previews are requested first; justified rows and columns take the original's
// proportions from the preview. A folder tile looks like its row in the Buba tree: the tree's icon in the
// folder color, and the name in that color while the tree colors names; its picture is the preview of a file
// the view names (`FolderFace`: the cover or the folder's first picture), taken from the same preview store.
// Names are text only.
import { Platform, setIcon, type Plugin, type Vault } from 'obsidian';
import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type VirtualizerOptions,
} from '@tanstack/virtual-core';
import { colorCss } from '../../core/color/value.ts';
import { t } from '../../core/i18n/dict/grid.ts';
import { formatFamily, formatInk, formatLabel } from '../../core/format/family.ts';
import { badgeFits, type Size } from '../../core/layout/badge.ts';
import { heldRow, heldRows, keptBreaks, rowAt, type HeldRow, type Row } from '../../core/layout/justified.ts';
import { revealOffset } from '../../core/layout/reveal.ts';
import { uniformGrid } from '../../core/layout/uniform.ts';
import type { GridViewState } from '../../core/layout/view-state.ts';
import {
  firstVisible,
  holdUpTo,
  tilesIn,
  waterfall,
  type Waterfall,
  type WaterfallKeep,
} from '../../core/layout/waterfall.ts';
import type { GridItem } from '../../core/sort/grid-items.ts';
import type { FileRecord } from '../../platform/files/file-index.ts';
import { excerptStore, type ExcerptStore } from '../../platform/previews/excerpts.ts';
import { excerptable, previewKind } from '../../platform/previews/plan.ts';
import { previewStore, type PreviewStore } from '../../platform/previews/store.ts';
import { settingsOf } from '../../platform/settings.ts';
import { coverInFront } from '../../core/settings/settings.ts';
import { BACK_BOX, coverSize, FRONT_BOX, MIDDLE } from '../../core/layout/cover-frame.ts';
import type { CoverFrame } from '../../core/storage/types.ts';
import { startFraming } from './cover-frame.ts';
import './file-tiles.css';
import './folder-tiles.css';
import './tiles.css';

export type Tile = GridItem<FileRecord>;

/** How tiles are shown: part of the view state. */
export type TileLook = Pick<GridViewState, 'layout' | 'size' | 'showNames' | 'fit'>;

/** A tile rectangle in grid body coordinates: from the top left of the scrolled content. */
export interface TileRect {
  path: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Body place for a tab history step (the view's ephemeral state): the path of the first tile of the top
 * visible row and the distance of its row top from the viewport top, px, the same thing justified
 * recalculation holds (`#hold`); for columns, the lowest-index tile under the body padding and its top.
 */
export interface TilePlace {
  readonly path: string;
  readonly offset: number;
}

/**
 * What a folder tile shows (view.ts, `setFolderFaces`): the tree row's look and the picture. `color` is
 * already through `colorCss`, `contrast` holds `mod-low-contrast-<theme>` classes of that color, `picture` is
 * a vault path whose preview fills the tile, or `null` for the icon.
 */
export interface FolderFace {
  readonly icon: string;
  readonly color: string | null;
  readonly contrast: readonly string[];
  readonly picture: string | null;
  /** `picture` is the folder's own cover, not its first picture. */
  readonly cover?: boolean;
  /** How the own cover sits in the tile ("Move cover"); none means in the middle, just filling it. */
  readonly frame?: CoverFrame | null;
  /**
   * Up to three files lying in the folder ("With files inside"), vault paths: pictures, and documents in their
   * own proportions (their first page, else a blank page with the type).
   */
  readonly peeks?: readonly string[];
}

/** A folder tile without a face provider: the grey folder icon, no picture. */
const PLAIN_FACE: FolderFace = { icon: 'folder', color: null, contrast: [], picture: null };

/** Folder color classes on the tile element: tiles.css paints the icon and, under the tree setting, the name. */
const FOLDER_COLOR = 'mod-folder-color';
const LOW_CONTRAST = ['mod-low-contrast-light', 'mod-low-contrast-dark'];

/** Tile class: an element has it while it shows a file or subfolder; pooled elements do not. */
const TILE = 'buba-tile';
/** "First tiles visible" mark; the performance harness times grid opening by it. */
const PAINTED = 'buba-grid-painted';
/** Gap between tiles and body padding, px. */
const GAP = 8;
const PAD = 8;
/** Extra rows above and below the visible ones. */
const OVERSCAN = 2;
/**
 * How long a shown tile (`reveal`) stays held in the viewport while previews arrive and the grid re-lays out,
 * ms; the user's own wheel, press, key or touch on the body releases it at once.
 */
const REVEAL_HOLD_MS = 15_000;
/** What the user does on the body to scroll it: any of these releases a shown tile. */
const USER_SCROLL = ['wheel', 'pointerdown', 'keydown'] as const;
/**
 * Touch tail, ms: after `touchend` the body still counts as scrolling, because iOS momentum starts without
 * touch events; TanStack Virtual waits the same (`_iosJustTouchEnded`).
 */
const TOUCH_TAIL = 150;

/** Row layout: the row count, a row's picture height and its tiles from left to right. */
interface Model {
  readonly rows: number;
  height(row: number): number;
  tiles(row: number, visit: (index: number, left: number, width: number) => void): void;
  /** The row that holds the tile with this index. */
  rowOf(index: number): number;
  /** Justified rows as shown; the uniform grid has none. */
  readonly justified?: readonly Row[];
  /** Columns as shown: model rows are body strips, while each tile has its own top and height. */
  readonly waterfall?: Waterfall;
}

const EMPTY: Model = { rows: 0, height: () => 0, tiles: () => {}, rowOf: () => 0 };

function uniformModel(count: number, width: number, size: number): Model {
  const grid = uniformGrid(count, width, size, GAP);
  return {
    rows: grid.rows,
    height: () => grid.rowHeight,
    tiles(row, visit) {
      const from = row * grid.columns;
      const to = Math.min(count, from + grid.columns);
      for (let index = from; index < to; index += 1)
        visit(index, (index - from) * (grid.tile + GAP), grid.tile);
    },
    rowOf: (index) => Math.floor(index / grid.columns),
  };
}

/** Model over justified rows (`justifiedRows`, `heldRows`). */
function justifiedModel(rows: readonly Row[]): Model {
  return {
    justified: rows,
    rows: rows.length,
    height: (row) => rows[row]?.height ?? 0,
    tiles(row, visit) {
      for (const item of rows[row]?.items ?? []) visit(item.index, item.left, item.width);
    },
    rowOf: (index) => rowAt(rows, index),
  };
}

/**
 * Column model (`waterfall`): virtualizer rows are body strips with pitch `pitch` = column width, caption and
 * gap, the row pitch of a uniform grid of the same size, so `OVERSCAN` is the same in pixels. A strip holds
 * the tiles that touch it (`tilesIn`); a tall tile touches several strips. The model row height is the column
 * width: with the caption and gap that makes the pitch, and the virtualizer puts strip `row` at
 * `PAD + row · pitch`.
 */
function waterfallModel(layout: Waterfall, pitch: number, count: number): Model {
  const rows = count > 0 ? Math.max(1, Math.ceil(layout.height / pitch)) : 0;
  return {
    waterfall: layout,
    rows,
    height: () => layout.width,
    tiles(row, visit) {
      tilesIn(layout, row * pitch, (row + 1) * pitch, (index) =>
        visit(index, layout.column[index]! * (layout.width + layout.gap), layout.width),
      );
    },
    rowOf: (index) => Math.floor((layout.top[index] ?? 0) / pitch),
  };
}

/** Justified rows and columns take picture proportions from previews; the uniform grid does not need them. */
const byAspects = (layout: TileLook['layout']): boolean => layout === 'justified' || layout === 'waterfall';

/**
 * A tile placeholder until a preview arrives: an icon by file type (src/core/format/family.ts). A file whose
 * preview is neither an image nor a video frame also gets a format label (`format`): the text, and the family
 * color as the `--buba-format-color` value (`colorCss`: a preset or a custom `#rrggbb`; empty means neutral,
 * Obsidian's text color in tiles.css). For PSD and AI the label shows while there is no thumbnail and stays
 * if the file has none; once a preview arrives, `has-preview` makes tiles.css hide the label and icon, and
 * the corner badge appears. Images and videos whose preview is being built keep the plain grey icon without a
 * label, so scrolling a big folder does not flash colored "PNG" labels. A file without an extension
 * (`README`, a name ending in a dot) gets no label either: on a short tile tiles.css hides the `mod-format`
 * icon, and an empty label would leave the tile blank.
 */
interface Stub {
  readonly icon: string;
  readonly format: boolean;
  readonly plate: string;
  readonly color: string;
  /** Letters on the document silhouette instead of the icon (file-tiles.css); empty means the icon. */
  readonly mark?: string;
  /** Letter and icon color on the silhouette: on a light or dark fill, or the theme text on a neutral one. */
  readonly ink?: 'light' | 'dark' | 'theme';
}

const FOLDER: Stub = { icon: 'folder', format: false, plate: '', color: '' };

function stubOf(tile: Tile): Stub {
  if (tile.kind === 'folder') return FOLDER;
  const { ext } = tile.file;
  const { icon, color, mark } = formatFamily(ext);
  const plate = formatLabel(ext);
  const kind = previewKind(ext);
  if (kind === 'image' || kind === 'video' || plate === '')
    return { icon, format: false, plate: '', color: '' };
  return { icon, format: true, plate, color: colorCss(color) ?? '', mark: mark ?? '', ink: formatInk(color) };
}

/** Extension of a vault path, without the dot; empty when the name has none. */
function extOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Format badge text; a folder has no badge, and CSS hides the empty one (`:empty`). */
const formatOf = (tile: Tile): string => (tile.kind === 'file' ? tile.file.ext.toUpperCase() : '');

/**
 * A file can have a preview: an image, a video frame, the embedded PSD and AI thumbnail, the first PDF page,
 * or the first lines of MD and TXT as text.
 */
const hasPreview = (tile: Tile | undefined): boolean =>
  tile?.kind === 'file' && (previewKind(tile.file.ext) !== null || excerptable(tile.file.ext));

/** The original plays on hover: video and GIF. */
const playsOnHover = (ext: string): boolean => ext.toLowerCase() === 'gif' || previewKind(ext) === 'video';

/** Parts of a tile element and what it shows now. */
interface Parts {
  readonly thumb: HTMLElement;
  readonly icon: HTMLElement;
  /** Format label: its text shows while the tile picture has `mod-format`. */
  readonly plate: HTMLElement;
  readonly image: HTMLImageElement;
  /** First lines of MD and TXT: `textContent` only, never HTML. */
  readonly text: HTMLElement;
  /** The text in `text`; empty means no first lines. */
  excerpt: string;
  readonly badges: HTMLElement;
  readonly badge: HTMLElement;
  readonly name: HTMLElement;
  /** Created once, when the tile first gets a comment. */
  comment?: HTMLElement;
  folder: boolean;
  iconId: string;
  /**
   * The tile picture has `mod-format`: the file's preview is neither an image nor a video frame (PSD, AI,
   * AEP, ZIP…).
   */
  format: boolean;
  /** The `--buba-format-color` value on the tile picture; empty means unset. */
  color: string;
  /** The preview's `blob:` URL in `image`; empty means the icon shows. */
  url: string;
  /** A folder tile: the path whose preview it shows (`FolderFace.picture`); empty for none and for files. */
  picture: string;
  /** A folder tile: the `--buba-color` value on the element; empty means no folder color. */
  tint: string;
  marks: readonly string[];
  /** The badge is not hidden by the `badgeFits` rule. */
  badgeShown: boolean;
  place?: Place;
  /** Folder shape parts, made when the element first shows a folder (folder-tiles.css). */
  fold?: FoldParts;
  /** A folder tile: the paths whose previews peek out of it, in card order. */
  peeks: readonly string[];
  /** Document silhouette parts, made when the element first shows a file without a picture (file-tiles.css). */
  doc?: DocParts;
}

/** Folder shape over the tile picture: back plate, cards inside, slanted front, name. */
interface FoldParts {
  readonly cards: readonly {
    readonly card: HTMLElement;
    readonly image: HTMLImageElement;
    readonly label: HTMLElement;
  }[];
  readonly name: HTMLElement;
  /** Card content and place key per card, written only on change. */
  readonly shown: string[];
  /** The preview whose average color is on the tile (`#average`). */
  average: string;
  /** The cover's frame from the folder look, `null` for none (`#frame`). */
  frame: CoverFrame | null;
  /** The frame CSS written on the tile, to write only on change; empty for none. */
  framed: string;
}

/** Document silhouette of a file without a picture: letters or the family icon, the type under them. */
interface DocParts {
  readonly root: HTMLElement;
  readonly letters: HTMLElement;
  readonly icon: HTMLElement;
  readonly label: HTMLElement;
  /** What is written now, so each part is written only on change; `null` before the first fill. */
  mark: string | null;
  drawn: string;
  ink: string;
  text: string;
}

/** Width over height of the document silhouette (file-tiles.css: `aspect-ratio: 0.8`). */
const DOC_ASPECT = 0.8;

/** A card place: offset from the center and down into the folder, % of the tile, and tilt, degrees. */
type CardPlace = readonly [number, number, number];
/**
 * Places of 1, 2 and 3 cards, back to front: at rest a loose stack inside the folder, on hover a fan, both a
 * little uneven (word of the owner 25.10). The right card stands higher, so it shows above the raised right
 * part of the front (word of the owner 26.10).
 */
const CARD_REST: readonly (readonly CardPlace[])[] = [
  [],
  [[0, 12, -3]],
  [
    [-5, 12, -5],
    [5, 4, 4],
  ],
  [
    [-6, 13, -7],
    [6, 3.5, 5],
    [-1, 15.5, -2],
  ],
];
// The fan stays inside the tile: a card fits 49 % and tilts up to 10°, so its center is at most 19 % off the
// middle (word of the owner 26.10: files never stick out past the folder).
const CARD_FAN: readonly (readonly CardPlace[])[] = [
  [],
  [[0, -6, -2]],
  [
    [-13, 0, -7],
    [13, -3, 6],
  ],
  [
    [-19, 0, -10],
    [18, 2.5, 8],
    [-1, -7, 2.5],
  ],
];
/** A card fits a square of this share of the tile, %. */
const CARD_BOX = 49;
/** Width over height of a document card without a picture: a page. */
const PAGE_ASPECT = 0.71;
/** Average colors of folder pictures remembered, by preview URL. */
const AVERAGES = 400;

/** Average color of a decoded picture as `rgb(r g b)`, from an 8 × 8 copy; null where the canvas refuses. */
function averageColor(image: HTMLImageElement): string | null {
  const canvas = createEl('canvas');
  canvas.width = canvas.height = 8;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, 8, 8);
    const data = context.getImageData(0, 0, 8, 8).data;
    const sum = [0, 0, 0];
    for (let at = 0; at < data.length; at += 4) for (let c = 0; c < 3; c++) sum[c]! += data[at + c]!;
    const [r, g, b] = sum.map((value) => Math.round(value / (data.length / 4)));
    return `rgb(${r} ${g} ${b})`;
  } catch {
    return null;
  }
}

/** A tile's place in the grid body, px. */
interface Place {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Height of the tile picture: the row without the caption. */
  readonly thumb: number;
}

/** Format badge as measured by the probe: size and inset from the right edge of the tile picture, px. */
interface BadgeSize extends Size {
  readonly inset: number;
}

/** The original playing on hover: the tile element and what was inserted into it. */
interface Playing {
  readonly el: HTMLElement;
  readonly media: HTMLVideoElement | HTMLImageElement;
  readonly video: boolean;
}

const NO_MARKS: readonly string[] = [];

/** A value usable in classList: a non-empty string without spaces. */
const isClass = (value: unknown): value is string => typeof value === 'string' && /^\S+$/.test(value);

/**
 * Where to scroll after a new layout: to the top, keep as is, bring the row of the tile with this index to
 * the top, or keep the tile's row at its previous distance from the viewport top.
 */
type Scroll = 'top' | 'keep' | number | { readonly tile: number; readonly offset: number };

/**
 * Maps a tile index in the old content to its index in the new one; `undefined` if it left without
 * replacement (`#where`).
 */
type Where = (at: number) => number | undefined;

/**
 * The content, width, tile size and row breaks justified rows were laid out for: `breaks` sit at the first
 * visible tiles and later recalculations carry them over; `holds` are the edges of the row held under the
 * mouse while the hold lasts (`heldRows`), cleared by the recalculation when the mouse leaves; `above` means
 * the rows above it were held too: at the start of a folder scrolling has no room to give.
 */
interface Shown {
  readonly items: readonly Tile[];
  readonly width: number;
  readonly size: number;
  readonly breaks: readonly number[];
  readonly holds: readonly number[];
  readonly above: boolean;
}

/**
 * The content, width and tile size columns were laid out for, and how they are shown (`waterfall`). `placed`
 * is the proportion each tile is shown with: for held tiles, the one the previous layout gave them; `stale`
 * lists, ascending, the tiles the viewport hold keeps at an old proportion (not tiles held only under the
 * mouse): visible ones among them stay as long as visible tiles follow them (`#keepFallen`).
 */
interface Fallen {
  readonly items: readonly Tile[];
  readonly width: number;
  readonly size: number;
  readonly layout: Waterfall;
  readonly placed: Float64Array;
  readonly stale: Int32Array;
}

/**
 * Column hold (the core's `WaterfallKeep`) and its viewport part: `hold` ≤ `upTo`, the rest up to `upTo` is
 * held by the mouse.
 */
interface FallenKeep extends WaterfallKeep {
  readonly hold: number;
}

/**
 * Boundary of column tiles that start above `y`: 1 + the largest index of a tile with top < `y`; 0 if none.
 * Top is not monotonic in the index (a column tie within tolerance can place a tile slightly above the
 * previous one, `waterfall.ts`), but it grows within a column: binary search per column, like the core's
 * `holdUpTo`.
 */
function startedAbove(layout: Waterfall, y: number): number {
  let upTo = 0;
  for (const ids of layout.byColumn) {
    let low = 0;
    let high = ids.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (layout.top[ids[middle]!]! < y) low = middle + 1;
      else high = middle;
    }
    if (low > 0) upTo = Math.max(upTo, ids[low - 1]! + 1);
  }
  return upTo;
}

/** The largest of the ascending indexes `ids` below `limit`; −1 if none. */
function lastBelow(ids: Int32Array, limit: number): number {
  let low = 0;
  let high = ids.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ids[middle]! < limit) low = middle + 1;
    else high = middle;
  }
  return low > 0 ? ids[low - 1]! : -1;
}

/**
 * The core carried the hold of `from` into layout `to`: same columns, column width, gap and caption, and the
 * height limit of `from` not above the new one, the `waterfall` condition (src/core/layout/waterfall.ts);
 * otherwise a fresh layout.
 */
const keptIn = (from: Waterfall, to: Waterfall): boolean =>
  from.columns === to.columns &&
  from.width === to.width &&
  from.gap === to.gap &&
  from.extra === to.extra &&
  from.tall <= to.tall;

/** File name without its extension, from a vault path. */
function stemOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * The folder front's outline in the reference component's coordinates, the same path as the front mask in
 * folder-tiles.css (`--buba-fold-front-mask`, raised part on the left; the CSS mirrors it to the right). The
 * view box ends at the path's bottom, so the front's lower edge is the box's and the plate does not show
 * under it.
 */
const FOLD_VIEWBOX = '0 0 236.2 122.05';
const FOLD_PATH =
  'M104.615 0.350494L33.1297 0.838776C32.7542 0.841362 32.3825 0.881463 32.032 0.918854C31.6754 0.956907 31.3392 0.992086 31.0057 0.992096H31.0047C30.6871 0.99235 30.3673 0.962051 30.0272 0.929596C29.6927 0.897686 29.3384 0.863802 28.9803 0.866119L13.2693 0.967682H13.2527L13.2352 0.969635C13.1239 0.981406 13.0121 0.986674 12.9002 0.986237H9.91388C8.33299 0.958599 6.76052 1.22345 5.27423 1.76651H5.27325C4.33579 2.11246 3.48761 2.66213 2.7879 3.37393L2.49689 3.68839L2.492 3.69424C1.62667 4.73882 1.00023 5.96217 0.656067 7.27725C0.653324 7.28773 0.654065 7.29886 0.652161 7.30948C0.3098 8.62705 0.257231 10.0048 0.499817 11.3446L12.2147 114.399L12.2156 114.411L12.2176 114.423C12.6046 116.568 13.7287 118.508 15.3934 119.902C17.058 121.297 19.1572 122.056 21.3231 122.049V122.05H215.379C217.76 122.02 220.064 121.192 221.926 119.698V119.697C223.657 118.384 224.857 116.485 225.305 114.35L225.307 114.339L235.914 53.3798L235.968 53.1093L235.97 53.0985L235.971 53.0888C236.134 51.8978 236.044 50.685 235.705 49.5321C235.307 48.1669 234.63 46.9005 233.717 45.8144L233.383 45.4296C232.58 44.5553 231.614 43.8449 230.539 43.3398C229.311 42.7628 227.971 42.4685 226.616 42.4774H146.746C144.063 42.4705 141.423 41.8004 139.056 40.5263C136.691 39.2522 134.671 37.4127 133.175 35.1689L113.548 5.05948L113.544 5.05362L113.539 5.04776C112.545 3.65165 111.238 2.51062 109.722 1.72061C108.266 0.886502 106.627 0.422235 104.952 0.365143V0.364166L104.633 0.350494H104.615Z';

export class TileGrid {
  readonly #scroller: HTMLElement;
  readonly #sizer: HTMLElement;
  readonly #virtualizer: Virtualizer<HTMLElement, HTMLElement>;
  readonly #options: VirtualizerOptions<HTMLElement, HTMLElement>;
  readonly #unmount: () => void;
  readonly #parts = new WeakMap<HTMLElement, Parts>();
  readonly #vault: Vault;
  readonly #plugin: Plugin;
  readonly #previews: PreviewStore;
  readonly #excerpts: ExcerptStore;
  readonly #offExcerpt: () => void;
  readonly #offReady: () => void;
  readonly #offRemoved: () => void;
  #items: readonly Tile[] = [];
  #look: TileLook = { layout: 'justified', size: 160, showNames: true, fit: 'contain' };
  #model: Model = EMPTY;
  /**
   * Tile proportions for justified rows and columns; an arriving preview updates its own in place, without a
   * pass over all tiles.
   */
  #aspects: number[] = [];
  /** The content `#aspects` was built for: new content means rebuild. */
  #aspectsOf: readonly Tile[] | null = null;
  /**
   * Original proportions already known from previews, so the layout does not jump when a preview is evicted
   * from memory.
   */
  readonly #knownAspects = new Map<string, number>();
  /** Tile index by path; `null` means rebuild: the content changed. */
  #indexByPath: Map<string, number> | null = null;
  /** A justified recalculation for arrived previews waits for the frame. */
  #reflowFrame = 0;
  /**
   * The body is scrolling: a scroll event came, and its end (`isScrolling` false in the virtualizer) has not
   * yet.
   */
  #scrolling = false;
  /**
   * A preview recalculation waits for the scroll to end: on a phone the layout does not change mid-scroll
   * (`#reflow`).
   */
  #reflowWaits = false;
  /**
   * On a phone, tiles whose preview brought a new proportion that the preview recalculation has not shown
   * yet: path → proportion as shown. A content change while that recalculation waits lays them out as shown
   * (`#relayout`).
   */
  readonly #unshown = new Map<string, number>();
  /** A finger is on the grid body: from `touchstart` to `touchend` or `touchcancel` of the last finger. */
  #touching = false;
  /** Touch tail timer (`TOUCH_TAIL`); 0 means no tail. */
  #touchTail = 0;
  /** The grid wrote `scrollTop`: the next scroll event at that position is its echo, not a user scroll. */
  #echo = false;
  /**
   * The hold is active: for justified rows, the row under the aimed mouse (`#aimed`); for columns, the tiles
   * up to the largest one fully above the viewport and under the aimed mouse, shown at an old proportion.
   * Without it the layout would differ, so the mouse leaving recalculates it, and for columns so does the
   * scroll stopping: with the new hold boundary (the core's `held` contract, src/core/layout/waterfall.ts) it
   * releases held tiles that went below the viewport together with all after them, and keeps visible ones
   * (`#keepFallen`).
   */
  #held = false;
  /** Shown justified rows; `null` for another layout. */
  #shownOf: Shown | null = null;
  /** Shown columns; `null` for another layout. */
  #fallen: Fallen | null = null;
  /** What the grid last requested from the preview store. */
  #requested = '';
  /** The tile under the mouse. */
  #hovered: HTMLElement | null = null;
  /** Average colors of folder pictures by preview URL (`#average`). */
  readonly #averages = new Map<string, string>();
  /**
   * The tile under the aimed mouse: the mouse moved over it (`mousemove`); the hold keeps it. A tile that
   * appeared or moved under a still cursor gets `mouseenter` from Obsidian without mouse movement; it is not
   * aimed, like an Obsidian suggestion item that is selected only on `mousemove`.
   */
  #aimed: HTMLElement | null = null;
  #playing: Playing | null = null;
  /** Layout width: the body without the scrollbar and padding. */
  #width = 0;
  #nameHeight = 0;
  /**
   * Badges measured during this layout, by text: one probe per text, reset together with the caption
   * measurement.
   */
  readonly #badges = new Map<string, BadgeSize>();
  /** The layout waits for the body to show, and where to scroll then; `null` means the layout is fresh. */
  #pending: Scroll | null = null;
  /** The tile whose top is held while width and look change; a user scroll clears it. */
  #anchor: number | null = null;
  /** Where the grid itself scrolled the body: such a scroll keeps the anchor, any other clears it. */
  #ownOffset = 0;
  /**
   * The body was hidden and is not back in place yet: the browser scrolled it to the top; the place is the
   * remembered one.
   */
  #hidden = false;
  /**
   * A place from a history step waits for its content's layout: the body is hidden or there are no tiles yet
   * (`setPlace`).
   */
  #wanted: TilePlace | null = null;
  /**
   * A tile just shown by `reveal` and until when it is held: every layout keeps it in the viewport, and the
   * place it holds is this tile rather than the top row or the tile under the mouse, since arriving previews
   * re-break the rows between them.
   */
  #revealed: { path: string; until: number } | null = null;
  /**
   * The place the body showed when hiding deferred its layout: the content changed or a preview arrived while
   * the tab was in the background. `place()` returns it to the history step while the layout waits, as an
   * Obsidian note view returns its remembered scroll (`MarkdownView.getEphemeralState`). Snapshotted by the
   * first deferred recalculation; later ones do not overwrite it, since the model no longer matches them. A
   * new source and a layout of the visible body clear it.
   */
  #hiddenPlace: TilePlace | null = null;
  /**
   * On a phone, content that arrived while the body is coasting (`#coasting`): the layout does not change
   * mid-scroll, as for previews. While it waits the grid shows and reports the old content; the stop lays out
   * the last arrival in one recalculation in a frame (`#reflow`). `null` means nothing waits.
   */
  #waiting: readonly Tile[] | null = null;
  /** Visible tiles: index in `#items` → element. */
  #shown = new Map<number, HTMLElement>();
  /** Tiles of the previous layout: still on screen, they will take new paths. */
  #stale: HTMLElement[] = [];
  /** Hidden spare tiles without tile class, path and marks, so a lookup by path finds only visible ones. */
  #pool: HTMLElement[] = [];
  /** The folder whose cover "Move cover" is moving, with the frame so far; redraws of its tile keep it. */
  #framing: { path: string; frame: CoverFrame; stop: () => void } | null = null;
  readonly #marks = new Map<string, (path: string) => string[]>();
  #markPending = false;
  #faces: ((path: string) => FolderFace) | null = null;

  constructor(scroller: HTMLElement, plugin: Plugin) {
    this.#scroller = scroller;
    this.#plugin = plugin;
    this.#vault = plugin.app.vault;
    this.#previews = previewStore(plugin);
    this.#offReady = this.#previews.onReady((path) => this.#previewReady(path));
    this.#offRemoved = this.#previews.onRemoved((path) => this.#previewRemoved(path));
    // First lines arrived: only the tile's own element changes and the layout is not recalculated, since a
    // text tile has the placeholder's proportion. A batch per frame arrives in one frame (`excerpts.ts`).
    this.#excerpts = excerptStore(plugin);
    this.#offExcerpt = this.#excerpts.onReady((path) => {
      const index = this.#indexOf(path);
      const el = index === undefined ? undefined : this.#shown.get(index);
      if (el) this.#showPreview(el, this.#items[index!]!);
    });
    scroller.addClass('buba-tiles');
    // Touches only mark a finger on the body (`#coasting`); passive, so they do not hinder scrolling.
    scroller.addEventListener('touchstart', this.#touchStart, { passive: true });
    scroller.addEventListener('touchend', this.#touchEnd, { passive: true });
    scroller.addEventListener('touchcancel', this.#touchEnd, { passive: true });
    for (const type of USER_SCROLL) scroller.addEventListener(type, this.#release, { passive: true });
    this.#sizer = scroller.createDiv({ cls: 'buba-grid-sizer' });
    this.#options = {
      count: 0,
      getScrollElement: () => this.#scroller,
      estimateSize: (row) => this.#model.height(row) + this.#nameHeight,
      scrollToFn: elementScroll,
      observeElementRect: (instance, report) =>
        observeElementRect(instance, (rect) => {
          // The visible body is at most the window height. Enabling the plugin with a grid open opens the
          // view before the plugin styles arrive: the body is still unbounded and grows to the full layout
          // height, so without a cap the visible-range renderer would draw every tile of the folder at once.
          report({ width: rect.width, height: Math.min(rect.height, this.#scroller.win.innerHeight) });
          this.#resized();
        }),
      observeElementOffset: (instance, report) =>
        observeElementOffset(instance, (offset, isScrolling) => {
          // An echo of our own write does not extend the scroll.
          const echo = this.#echo && Math.abs(offset - this.#ownOffset) < 1;
          this.#echo = false;
          this.#scrolling = isScrolling && !echo;
          // The scroll ended: a recalculation or content that waited for it runs in the next frame and keeps
          // the top tile; held columns recalculate with the new boundary: held tiles that went below the
          // viewport, with all after them, take their own proportions, visible ones stay as shown.
          if (!isScrolling && (this.#waits() || this.#heldColumns())) this.#reflow();
          // The browser scrolls a hidden body to the top; that is not a place the user scrolled to.
          if (this.#scroller.clientHeight === 0) {
            this.#hidden = true;
            return;
          }
          if (Math.abs(offset - this.#ownOffset) > 1) this.#anchor = null;
          report(offset, isScrolling);
        }),
      onChange: () => this.#paint(),
      // Layout for a new size runs in the frame after measuring: changing the DOM right inside ResizeObserver
      // while the view is recreated causes "ResizeObserver loop completed with undelivered notifications".
      useAnimationFrameWithResizeObserver: true,
      gap: GAP,
      paddingStart: PAD,
      paddingEnd: PAD,
      overscan: OVERSCAN,
    };
    this.#virtualizer = new Virtualizer(this.#options);
    this.#unmount = this.#virtualizer._didMount();
    this.#virtualizer._willUpdate();
  }

  /**
   * New content or look; `toTop` means another source opened and the body scrolls to the top. A content
   * change keeps the place before the tile at the viewport top (`#relayout`); on a phone, while the body
   * coasts, it waits for the stop (`#waiting`).
   */
  update(items: readonly Tile[], look: TileLook, toTop: boolean): void {
    const prev = this.#look;
    const relook =
      prev.layout !== look.layout || prev.size !== look.size || prev.showNames !== look.showNames;
    // Phone, body coasting: new content of the same source and look (including a new sort order) waits for
    // the stop: rows rebuilt mid-scroll jump, and writing `scrollTop` during iOS momentum cuts it off. A new
    // source or a look change does not wait.
    const sameLook = !relook && prev.fit === look.fit;
    // Same paths in the same order, same look, body visible and nothing waiting: the layout is the same,
    // since proportions come from previews, not from records (a file content edit). Layout snapshots are
    // rebound to the new array with the same indexes; visible previews are requested again and the store
    // rebuilds stale ones.
    if (!toTop && sameLook && this.#waiting === null && this.#pending === null && this.#bodyWidth() > 0) {
      const was = this.#items;
      let same = was.length === items.length;
      for (let i = 0; same && i < items.length; i++) same = was[i]!.path === items[i]!.path;
      if (same) {
        if (this.#aspectsOf === was) this.#aspectsOf = items;
        if (this.#shownOf?.items === was) this.#shownOf = { ...this.#shownOf, items };
        if (this.#fallen?.items === was) this.#fallen = { ...this.#fallen, items };
        this.#items = items;
        this.#requested = '';
        this.#paint();
        return;
      }
    }
    if (!toTop && sameLook && this.#coasting() && this.#pending === null && this.#bodyWidth() > 0) {
      this.#waiting = items;
      return;
    }
    this.#waiting = null;
    const scroll: Scroll = toTop ? 'top' : relook ? (this.#anchorTile() ?? 'keep') : 'keep';
    if (!relook) this.#anchor = null; // other content, so the tile index no longer applies
    if (toTop) this.#wanted = null; // a history place is not for a new source
    if (toTop) this.#revealed = null;
    // A hidden body will defer the layout, so the place is snapshotted before the content is replaced, while
    // model and content still match.
    if (toTop) this.#hiddenPlace = null;
    else if (this.#pending === null && this.#bodyWidth() === 0) this.#hiddenPlace = this.place();
    // The layout already waits to show with a tile index (a preview recalculation): the index is wrong in the
    // new content, so the snapshot is kept on show.
    else if (!relook && this.#pending !== null && this.#pending !== 'top' && this.#hiddenPlace !== null)
      this.#pending = 'keep';
    // The visible body keeps the place before the row at the viewport top (under the mouse, before its row),
    // for columns before the tile: snapshotted by path before the content is replaced.
    const held =
      !toTop && !relook && byAspects(look.layout) && this.#pending === null && this.#bodyWidth() > 0
        ? this.#heldPlace()
        : null;
    this.#items = items;
    this.#indexByPath = null;
    // A file may have changed in place: the same paths are requested again and the store rebuilds stale
    // previews.
    this.#requested = '';
    this.#look = { layout: look.layout, size: look.size, showNames: look.showNames, fit: look.fit };
    // "Crop to tile" exists only for the uniform grid: in justified rows and columns a tile already has the
    // picture's proportions.
    this.#sizer.toggleClass('is-cover', look.layout === 'uniform' && look.fit === 'cover');
    // Columns: an image taller than the limit, or held at an old proportion, shows its top part without bars
    // (tiles.css).
    this.#sizer.toggleClass('is-waterfall', look.layout === 'waterfall');
    this.#markPending = true;
    this.#relayout(scroll, false, held);
  }

  /**
   * Where the body stands, for a tab history step; `null` without a layout or tiles. While the layout waits
   * for the body to show, the place the body showed before it (`#hiddenPlace`).
   */
  place(): TilePlace | null {
    if (this.#wanted) return this.#wanted; // not applied yet, so the step carries it on
    if (this.#pending !== null) return this.#hiddenPlace;
    const top = this.#offset();
    const tile = this.#topTile(top);
    const path = tile === undefined ? undefined : this.#items[tile]?.path;
    return path === undefined ? null : { path, offset: this.#tileTop(tile!) - top };
  }

  /**
   * Restores a place from a history step: the tile at its previous distance from the viewport top. At once if
   * tiles are laid out, otherwise with this content's layout, when the body shows or tiles arrive. Without a
   * tile at this path, from the top.
   */
  setPlace(place: TilePlace): void {
    this.#wanted = place;
    this.#revealed = null; // a history step's place wins over a shown tile
    this.#relayout('keep');
  }

  /**
   * Shows the tile of `path` if it is not fully visible: it comes to the top edge (`revealOffset`), or as far
   * as the body scrolls near the end, through the same place restore as a history step. While the layout
   * waits (a hidden body, a coasting phone body), the tile goes to the top edge when the layout runs. Then
   * the tile is held in view for `REVEAL_HOLD_MS` while previews arrive and the width changes, until the user
   * scrolls the body. A path the grid does not show is ignored.
   */
  reveal(path: string): void {
    const index = this.#indexOf(path);
    if (index === undefined) return;
    const hold = { path, until: Date.now() + REVEAL_HOLD_MS };
    if (this.#pending !== null || this.#waiting !== null || this.#scroller.clientHeight === 0) {
      this.setPlace({ path, offset: PAD });
      this.#revealed = hold;
      return;
    }
    const view = { top: this.#offset(), height: this.#scroller.clientHeight };
    const offset = revealOffset({ top: this.#tileTop(index), height: this.#tileHeight(index) }, view, PAD);
    // Held even if already visible: arriving previews re-break the rows around it.
    this.#revealed = hold;
    if (offset === null) return;
    this.setPlace({ path, offset });
    this.#revealed = hold;
    // A width change right after, such as the file panel sliding out for the new selection, holds this tile
    // rather than the top row: near the end of the folder the body cannot bring it to the top edge, and the
    // top row held under a narrower width would push it below the viewport. Any scroll releases it.
    this.#anchor = index;
  }

  /** The held shown tile's index, if the hold is still on and the grid shows it. */
  #revealedTile(): number | undefined {
    const held = this.#revealed;
    if (held === null) return undefined;
    if (Date.now() > held.until) {
      this.#revealed = null;
      return undefined;
    }
    return this.#indexOf(held.path);
  }

  /** The user scrolls the body themselves: the shown tile is no longer held. */
  readonly #release = (): void => {
    this.#revealed = null;
  };

  /** Tile paths in display order, subfolders first. */
  pathsInOrder(): string[] {
    return this.#items.map((item) => item.path);
  }

  /** Rectangles of all tiles from the layout, including those out of view. */
  tileRects(): TileRect[] {
    const rects: TileRect[] = [];
    const columns = this.#model.waterfall;
    if (columns) {
      // Columns: each tile's rectangle from the core layout, in tile order.
      const count = Math.min(this.#items.length, columns.top.length);
      for (let index = 0; index < count; index += 1) {
        rects.push({
          path: this.#items[index]!.path,
          left: PAD + columns.column[index]! * (columns.width + columns.gap),
          top: PAD + columns.top[index]!,
          width: columns.width,
          height: columns.thumb[index]! + this.#nameHeight,
        });
      }
      return rects;
    }
    let top = PAD;
    for (let row = 0; row < this.#model.rows; row += 1) {
      const height = this.#model.height(row) + this.#nameHeight;
      this.#model.tiles(row, (index, left, width) => {
        const item = this.#items[index];
        if (item) rects.push({ path: item.path, left: PAD + left, top, width, height });
      });
      top += height + GAP;
    }
    return rects;
  }

  /**
   * Folder tile faces (`FolderFace`): applied to visible folder tiles at once and on every redraw; `null` gives
   * the grey folder icon without a picture.
   */
  setFolderFaces(faces: ((path: string) => FolderFace) | null): void {
    this.#faces = faces;
    this.refreshFolders();
  }

  /**
   * A folder's look or picture changed (the tree look, a cover, the folder content): visible folder tiles take
   * their face again, and new pictures are requested with the next draw of a laid-out body.
   */
  refreshFolders(): void {
    let folders = false;
    for (const [index, el] of this.#shown) {
      const item = this.#items[index];
      if (item?.kind !== 'folder') continue;
      folders = true;
      this.#face(el, item);
    }
    if (!folders || this.#width === 0 || this.#pending !== null) return;
    this.#requested = '';
    this.#paint();
  }

  /**
   * The "Program file tiles" setting changed: in rows and columns a file without a picture changes its
   * proportion (document-shaped or square), so the layout is computed again, keeping the scroll place.
   */
  restyle(): void {
    this.#aspectsOf = null;
    if (byAspects(this.#look.layout) && this.#width > 0) this.#relayout(this.#hold(), true);
  }

  /** Tile marks: applied to visible tiles at once and on every redraw. */
  setMarks(marks: ((path: string) => string[]) | null, key = 'selection'): void {
    if (marks) this.#marks.set(key, marks);
    else this.#marks.delete(key);
    for (const [index, el] of this.#shown) {
      const item = this.#items[index];
      if (!item) continue;
      this.#mark(el, item.path);
      const place = this.#parts.get(el)?.place;
      if (place) this.#fitBadge(el, item, place);
    }
  }

  destroy(): void {
    this.#stop();
    this.#offReady();
    this.#offRemoved();
    this.#offExcerpt();
    this.#previews.want([], this);
    this.#excerpts.want([], this);
    if (this.#reflowFrame) this.#scroller.win.cancelAnimationFrame(this.#reflowFrame);
    this.#reflowFrame = 0;
    this.#waiting = null;
    this.#scroller.removeEventListener('touchstart', this.#touchStart);
    this.#scroller.removeEventListener('touchend', this.#touchEnd);
    this.#scroller.removeEventListener('touchcancel', this.#touchEnd);
    for (const type of USER_SCROLL) this.#scroller.removeEventListener(type, this.#release);
    this.#scroller.win.clearTimeout(this.#touchTail);
    this.#touchTail = 0;
    this.#unmount();
    this.#sizer.remove();
    this.#scroller.removeClass('buba-tiles');
  }

  /** Width for the layout; 0 means the body is hidden: a background tab or collapsed sidebar. */
  #bodyWidth(): number {
    return Math.max(0, this.#scroller.clientWidth - 2 * PAD);
  }

  #resized(): void {
    const width = this.#bodyWidth();
    if (width === 0) {
      this.#hidden = true;
      return; // a hidden body keeps its layout: it is needed again on show
    }
    if (width !== this.#width || this.#pending !== null) {
      this.#relayout(this.#pending ?? this.#anchorTile() ?? 'keep');
      return;
    }
    // The browser scrolls a hidden body to the top, so restore the place the visible-range renderer saw.
    // Leave a visible body alone: the size notification comes a frame later, and a scroll not yet reported
    // would be undone.
    if (this.#hidden) this.#scrollTo(this.#virtualizer.scrollOffset ?? 0);
  }

  /**
   * The body's place. A visible body uses the live `scrollTop`: someone else's scroll is already in it, while
   * its event arrives only next frame. A hidden body, or one not back in place yet, uses the remembered one
   * (the TanStack Virtual approach: https://github.com/TanStack/virtual/issues/1283). A live value within a
   * pixel of the place the grid set counts as the grid's place: sub-pixel writes are skipped (`#scrollTo`),
   * so shifts of such recalculations add up instead of getting lost (like TanStack Virtual's
   * `_intendedScrollOffset`).
   */
  #offset(): number {
    if (this.#hidden || this.#scroller.clientHeight === 0) return this.#virtualizer.scrollOffset ?? 0;
    const live = this.#scroller.scrollTop;
    return Math.abs(live - this.#ownOffset) < 1 ? this.#ownOffset : live;
  }

  /**
   * The first tile of the top visible row, whose top is held when width and look change. It stays the same
   * while the body sits where the grid put it: otherwise every animation step of the sidebar or slider would
   * shift the place by a row.
   */
  #anchorTile(): number | null {
    const top = this.#offset();
    const revealed = this.#revealedTile();
    if (revealed !== undefined) return revealed;
    // The user or a module scrolled: the tile has changed even if the scroll event has not arrived yet.
    if (Math.abs(top - this.#ownOffset) > 1) this.#anchor = null;
    // The grid puts a row under the body padding, so the row there is the top visible one (`#topTile`).
    if (this.#anchor === null) this.#anchor = this.#topTile(top) ?? null;
    return this.#anchor;
  }

  #scrollTo(offset: number): void {
    this.#ownOffset = offset;
    // Only real moves are written: a pixel fraction is browser rounding, not scrolling, and writing
    // `scrollTop` on iOS cuts off momentum.
    if (Math.abs(this.#scroller.scrollTop - offset) >= 1) {
      this.#scroller.scrollTop = offset;
      this.#echo = true;
    }
    this.#virtualizer.scrollOffset = offset;
    if (this.#scroller.clientHeight > 0) this.#hidden = false;
  }

  /** Top of a row in the grid body. */
  #rowTop(row: number): number {
    let top = PAD;
    for (let each = 0; each < row; each += 1) top += this.#model.height(each) + this.#nameHeight + GAP;
    return top;
  }

  /** Top of a tile in the grid body: its own for columns, its row's top for rows. */
  #tileTop(index: number): number {
    const columns = this.#model.waterfall;
    return columns ? PAD + (columns.top[index] ?? 0) : this.#rowTop(this.#model.rowOf(index));
  }

  /** Height of a tile with its name: its own for columns, its row's for rows. */
  #tileHeight(index: number): number {
    const columns = this.#model.waterfall;
    const picture = columns ? (columns.thumb[index] ?? 0) : this.#model.height(this.#model.rowOf(index));
    return picture + this.#nameHeight;
  }

  /**
   * A new layout. `byPreview` is a recalculation for arrived previews; it and new content at the same width
   * and look keep the shown justified rows (`#keepShown`) and columns (`#keepFallen`); other recalculations
   * lay everything out anew. `held` is the tile a content change of the visible body holds (`update`); for a
   * layout deferred by hiding, the `#hiddenPlace` snapshot.
   */
  #relayout(scroll: Scroll, byPreview = false, held: TilePlace | null = null): void {
    const width = this.#bodyWidth();
    if (width === 0) {
      // A preview reached a hidden body: the content is unchanged, so snapshot the place before deferring the
      // layout.
      if (byPreview && this.#pending === null) this.#hiddenPlace = this.place();
      // Lay out when the body shows; a new source opens from the top whatever comes after it.
      const pending = this.#pending;
      this.#pending =
        pending === 'top' || scroll === 'top' ? 'top' : scroll === 'keep' ? (pending ?? 'keep') : scroll;
      this.#hidden = true;
      return;
    }
    // What a content change holds: `held` for a visible body; if the content changed while the body was
    // hidden, the tile it showed (the snapshot).
    const kept = held ?? (this.#pending === 'keep' ? this.#hiddenPlace : null);
    this.#hiddenPlace = null; // the body is visible, so the layout computes the place
    const wanted = this.#wanted;
    if (wanted && this.#items.length > 0) {
      this.#wanted = null;
      const tile = this.#indexOf(wanted.path);
      scroll = tile === undefined ? 'top' : { tile, offset: wanted.offset };
    }
    const place = this.#offset(); // before the new height, which could clip the place
    const { layout, size, showNames } = this.#look;
    // Shown justified rows are also kept when a body whose layout waited for it shows: the place is that
    // layout's `kept` snapshot.
    const shownOf =
      layout === 'justified' &&
      (byPreview || scroll === 'keep') &&
      (this.#pending === null || kept !== null) &&
      this.#shownOf?.width === width &&
      this.#shownOf.size === size
        ? this.#shownOf
        : null;
    // Shown columns, by the same rule.
    const fallenOf =
      layout === 'waterfall' &&
      (byPreview || scroll === 'keep') &&
      (this.#pending === null || kept !== null) &&
      this.#fallen?.width === width &&
      this.#fallen.size === size
        ? this.#fallen
        : null;
    // A justified content change keeps the place before tile `kept` (`#keptTile`): the top of the row
    // starting with it ends up at the same distance from the viewport top, and rows above the viewport are
    // laid out anew, since they are not visible. Whatever took that place (a new file, the same tile under a
    // new name) is visible; renamed tiles before it do not shift the place. Only if the old tiles found in
    // the new content (those staying by path and pairs by name or fingerprint, e.g. a renamed open folder,
    // `#pairs`) keep their order and there is at least one (`#orderKept`): a sort, or a rename after which no
    // name or fingerprint matched, keeps the place by pixel, as the uniform grid does, where an insertion
    // shifts tiles into place rather than rows. For columns the same place before the top tile; their start,
    // while unchanged, stays as shown (`#keepFallen`).
    const was = layout === 'justified' ? this.#shownOf : layout === 'waterfall' ? this.#fallen : null;
    // Where the old tiles are in the new content: staying ones and replacements (`#where`).
    const where = this.#where(was?.items ?? []);
    const pin =
      kept && scroll === 'keep' && was && !byPreview && this.#orderKept(was.items)
        ? this.#keptTile(was.items, kept, place, where)
        : null;
    const fall = fallenOf ? this.#keepFallen(place, fallenOf, where, byPreview) : undefined;
    // On a phone the preview recalculation shows arrived proportions while keeping the top tile. While it
    // waits (for the scroll end or a frame), new content lays out those tiles as shown: otherwise rows above
    // the viewport would re-lay out in place and the visible part would move, and holding it mid-momentum
    // would mean writing `scrollTop`.
    const unshown =
      !byPreview &&
      (shownOf !== null || fallenOf !== null) &&
      (this.#reflowWaits || this.#reflowFrame !== 0) &&
      this.#unshown.size > 0;
    if (!unshown) {
      this.#reflowWaits = false; // the layout takes all arrived aspects, nothing waits for scroll end
      this.#unshown.clear();
    }
    // New content also keeps the rows above the row under the mouse, if the shown layout kept them.
    let keep = shownOf
      ? this.#keepShown(place, shownOf, where, byPreview, !byPreview && shownOf.above, pin?.tile ?? null)
      : null;
    this.#pending = null;
    this.#width = width;
    this.#sizer.toggleClass('is-names-hidden', !showNames);
    this.#nameHeight = showNames ? this.#measureName() : 0;
    this.#badges.clear();
    const count = this.#items.length;
    if (byAspects(layout) && this.#aspectsOf !== this.#items) {
      this.#aspects = this.#items.map((item) => this.#aspect(item));
      this.#aspectsOf = this.#items;
    }
    let aspects = this.#aspects;
    if (unshown) {
      aspects = [...aspects];
      for (const [path, aspect] of this.#unshown) {
        const index = this.#indexOf(path);
        if (index !== undefined) aspects[index] = aspect;
      }
    }
    // The row under the mouse stays as shown; proportions that arrived for it and the rows before it wait for
    // the mouse to leave.
    const hold = () =>
      heldRows(aspects, width, size, GAP, keep?.breaks ?? [], keep?.holds ?? [], keep?.row ?? null);
    let justified = layout === 'justified' ? hold() : null;
    // If the place of the row under the mouse needs a scroll above the folder start, the rows above it are
    // kept as shown too: otherwise scrolling has no room to give and the row under the mouse would move up.
    if (shownOf && justified && keep?.row && !keep.above && byPreview && typeof scroll === 'object') {
      const at = rowAt(justified.rows, scroll.tile);
      const top = PAD + (justified.rows[at]?.top ?? 0) + at * this.#nameHeight;
      if (top - scroll.offset < -1e-6) {
        keep = this.#keepShown(place, shownOf, where, byPreview, true);
        justified = hold();
      }
    }
    // Columns: tiles up to the hold boundary as shown, the rest placed from the column ends after them
    // (core).
    const columns =
      layout === 'waterfall' ? waterfall(aspects, width, size, GAP, this.#nameHeight, fall) : null;
    this.#held = justified?.held ?? columns?.held ?? false;
    this.#model = justified
      ? justifiedModel(justified.rows)
      : columns
        ? waterfallModel(columns, columns.width + this.#nameHeight + GAP, count)
        : uniformModel(count, width, size);
    this.#shownOf = justified
      ? {
          items: this.#items,
          width,
          size,
          breaks: keep?.breaks ?? [],
          holds: justified.held ? (keep?.holds ?? []) : [],
          above: justified.held && (keep?.above ?? false),
        }
      : null;
    this.#fallen = columns ? this.#shownColumns(width, size, columns, aspects, fallenOf, fall) : null;
    const rows = this.#model.rows;
    const bottom = columns
      ? PAD + columns.height
      : rows > 0
        ? this.#rowTop(rows - 1) + this.#model.height(rows - 1) + this.#nameHeight
        : PAD;
    const total = bottom + PAD;
    this.#sizer.style.height = `${total}px`;
    if (pin) scroll = pin;
    const tileTopOf = (tile: number): number => this.#tileTop(Math.min(tile, count - 1));
    const target =
      scroll === 'top' || rows === 0
        ? 0
        : scroll === 'keep'
          ? place
          : typeof scroll === 'number'
            ? tileTopOf(scroll) - PAD
            : tileTopOf(scroll.tile) - scroll.offset;
    if (scroll === 'top') this.#anchor = null;
    // A held shown tile stays in the viewport whatever moved around it.
    const shown = this.#revealedTile();
    const fit =
      shown === undefined
        ? null
        : revealOffset(
            { top: this.#tileTop(shown), height: this.#tileHeight(shown) },
            { top: target, height: this.#scroller.clientHeight },
            PAD,
          );
    const goal = shown === undefined || fit === null ? target : this.#tileTop(shown) - fit;
    // The limit is the body's real limit: on a phone there is extra room under the content for Obsidian's bar
    // (tiles.css).
    this.#scrollTo(Math.max(0, Math.min(goal, this.#scroller.scrollHeight - this.#scroller.clientHeight)));
    this.#virtualizer.setOptions({ ...this.#options, count: rows });
    this.#stale.push(...this.#shown.values());
    this.#shown.clear();
    this.#virtualizer.measure(); // calls onChange → #paint
  }

  #measureName(): number {
    const probe = this.#sizer.createDiv({ cls: 'buba-tile-name buba-tile-probe', text: 'Ag' });
    const height = Math.ceil(probe.getBoundingClientRect().height);
    probe.remove();
    return height;
  }

  /**
   * Measures the badges of visible tiles not yet measured in this layout: a probe is a tile picture as wide
   * as the grid with the badge inside, like `#measureName`; all probes are read at once, one browser layout.
   * A hidden body answers with zeros: such a measurement is not remembered, and an unmeasured badge stays
   * hidden until a redraw of the visible body measures it.
   */
  #measureBadges(shown: ReadonlyMap<number, HTMLElement>): void {
    const probes = new Map<string, { thumb: HTMLElement; group: HTMLElement }>();
    const formats = new Set(['', ...[...shown.keys()].map((index) => formatOf(this.#items[index]!))]);
    for (const format of formats) {
      for (const comment of [false, true]) {
        if (format === '' && !comment) continue;
        const key = `${format}:${comment}`;
        if (this.#badges.has(key) || probes.has(key)) continue;
        const thumb = this.#sizer.createDiv({ cls: 'buba-tile-thumb buba-tile-probe' });
        thumb.style.width = `${this.#width}px`;
        const group = thumb.createDiv({ cls: 'buba-tile-badges' });
        if (comment) group.createSpan({ cls: 'buba-tile-comment' });
        group.createSpan({ cls: 'buba-tile-badge', text: format });
        probes.set(key, { thumb, group });
      }
    }
    if (probes.size === 0) return;
    for (const [key, { thumb, group }] of probes) {
      const box = thumb.getBoundingClientRect();
      const { width, height, right } = group.getBoundingClientRect();
      if (width > 0) this.#badges.set(key, { width, height, inset: box.right - right });
    }
    for (const { thumb } of probes.values()) thumb.remove();
  }

  /** The format badge is shown whole inside the tile picture with its inset, or not at all (`badgeFits`). */
  #fitBadge(el: HTMLElement, item: Tile, place: Place): void {
    const parts = this.#parts.get(el)!;
    const format = parts.format && parts.url === '' && parts.excerpt === '' ? '' : formatOf(item);
    const comment = parts.marks.includes('has-comment');
    const size = this.#badges.get(`${format}:${comment}`);
    const shown =
      (format === '' && !comment) ||
      (size !== undefined && badgeFits({ width: place.width, height: place.thumb }, size, size.inset));
    if (parts.badgeShown === shown) return;
    parts.badgeShown = shown;
    if (shown) {
      parts.badges.show();
      parts.badge.show();
    } else {
      parts.badges.hide();
      parts.badge.hide();
    }
  }

  #paint(): void {
    const rows = this.#virtualizer.getVirtualItems();
    const wanted = new Map<number, Place>();
    // Previews are requested in display order: rows in the viewport first, then the overscan above and below.
    const inView: string[] = [];
    const around: string[] = [];
    const viewTop = this.#virtualizer.scrollOffset ?? 0;
    const viewBottom = viewTop + (this.#virtualizer.scrollRect?.height ?? 0);
    const columns = this.#model.waterfall;
    for (const row of rows) {
      if (row.index >= this.#model.rows) continue;
      const thumb = this.#model.height(row.index);
      this.#model.tiles(row.index, (index, left, width) => {
        if (wanted.has(index)) return; // a tall column tile touches several strips but is one tile
        // In rows a tile takes the row's top and height; in columns its own from the layout.
        const high = columns ? columns.thumb[index]! : thumb;
        const top = columns ? PAD + columns.top[index]! : row.start;
        const height = high + this.#nameHeight;
        // Left and right edges on whole pixels: layout widths are fractional, and a tile at a fractional x
        // puts its badges and name between pixels. Each edge is rounded, so neighbours keep the gap. Tops stay
        // as laid out: scroll keeping works in layout coordinates.
        const x = Math.round(PAD + left);
        wanted.set(index, { left: x, top, width: Math.round(PAD + left + width) - x, height, thumb: high });
        const item = this.#items[index];
        const seen = top + height > viewTop && top < viewBottom;
        const face = item?.kind === 'folder' ? this.#faceOf(item.path) : null;
        if (item && hasPreview(item)) (seen ? inView : around).push(item.path);
        else if (face?.picture) (seen ? inView : around).push(face.picture);
        for (const peek of face?.peeks ?? [])
          if (peek !== face?.picture && previewKind(extOf(peek)) !== null) around.push(peek);
      });
    }
    const spare = new Set(this.#stale);
    this.#stale = [];
    for (const [index, el] of this.#shown) if (!wanted.has(index)) spare.add(el);
    // A tile that changed place takes its own element: the preview is not set again and a hover video keeps
    // playing.
    const own = new Map<string, HTMLElement>();
    for (const el of spare) if (el.dataset.path !== undefined) own.set(el.dataset.path, el);
    const shown = new Map<number, HTMLElement>();
    const fresh: number[] = [];
    for (const [index, place] of wanted) {
      const item = this.#items[index];
      if (!item) continue;
      const kept = this.#shown.get(index);
      if (kept) {
        shown.set(index, kept);
        continue;
      }
      const el = own.get(item.path);
      if (!el) {
        fresh.push(index);
        continue;
      }
      own.delete(item.path);
      spare.delete(el);
      this.#fill(el, item);
      this.#place(el, place);
      shown.set(index, el);
    }
    for (const index of fresh) {
      const item = this.#items[index]!;
      const el: HTMLElement = spare.values().next().value ?? this.#pool.pop() ?? this.#create();
      spare.delete(el);
      el.show();
      this.#fill(el, item);
      this.#place(el, wanted.get(index)!);
      shown.set(index, el);
    }
    this.#measureBadges(shown);
    for (const [index, el] of shown) {
      const item = this.#items[index]!;
      this.#mark(el, item.path);
      if (item.kind === 'folder') this.#face(el, item);
      this.#fitBadge(el, item, wanted.get(index)!);
    }
    for (const el of spare) {
      this.#retire(el);
      this.#pool.push(el);
    }
    this.#shown = shown;
    const visible = (this.#virtualizer.scrollRect?.height ?? 0) > 0 && this.#width > 0;
    if (this.#markPending && visible && (shown.size > 0 || this.#items.length === 0)) {
      this.#markPending = false;
      performance.clearMarks(PAINTED);
      performance.mark(PAINTED);
    }
    this.#request(visible ? [...inView, ...around] : []);
  }

  #place(el: HTMLElement, place: Place): void {
    this.#parts.get(el)!.place = place;
    el.style.transform = `translate(${place.left}px, ${place.top}px)`;
    el.style.width = `${place.width}px`;
    el.style.height = `${place.height}px`;
  }

  /**
   * Requests previews and first lines of visible tiles; the same paths are not requested twice in a row.
   * Other grid requests to the stores are dropped.
   */
  #request(paths: readonly string[]): void {
    const key = paths.join('\n');
    if (key === this.#requested) return;
    this.#requested = key;
    this.#previews.want(paths, this);
    this.#excerpts.want(
      paths.filter((path) => excerptable(path.slice(path.lastIndexOf('.') + 1))),
      this,
    );
  }

  #create(): HTMLElement {
    const el = this.#sizer.createDiv({ cls: TILE });
    const thumb = el.createDiv({ cls: 'buba-tile-thumb' });
    const icon = thumb.createDiv({ cls: 'buba-tile-icon' });
    // The label sits next to the icon, not inside it: `setIcon` replaces the icon element's first child.
    const plate = thumb.createSpan({ cls: 'buba-tile-plate' });
    const image = thumb.createEl('img', { cls: 'buba-tile-image', attr: { alt: '' } });
    const text = thumb.createDiv({ cls: 'buba-tile-text' });
    const badges = thumb.createDiv({ cls: 'buba-tile-badges' });
    const badge = badges.createSpan({ cls: 'buba-tile-badge' });
    const name = el.createDiv({ cls: 'buba-tile-name' });
    this.#parts.set(el, {
      thumb,
      icon,
      plate,
      image,
      text,
      excerpt: '',
      badges,
      badge,
      name,
      folder: false,
      iconId: '',
      format: false,
      color: '',
      url: '',
      picture: '',
      tint: '',
      marks: NO_MARKS,
      badgeShown: true,
      peeks: [],
    });
    // Phones have no hover playback.
    if (Platform.isDesktop) {
      el.addEventListener('mouseenter', () => this.#enter(el));
      el.addEventListener('mousemove', () => (this.#aimed = el));
      el.addEventListener('mouseleave', () => this.#leave(el));
      // A name cut with "…" shows whole in Obsidian's hover tooltip, as the path in the file panel: Obsidian
      // shows it for any element with `aria-label` under the mouse. The label is set just before, on
      // `pointerover` (it comes before `mouseover`), and only for a cut name: a whole one is not repeated.
      name.addEventListener('pointerover', () => {
        if (name.scrollWidth > name.clientWidth) name.setAttr('aria-label', name.textContent ?? '');
        else name.removeAttribute('aria-label');
      });
    }
    return el;
  }

  /**
   * A tile goes to the pool: hidden and no longer a tile, without class, path, `is-folder` and marks, without
   * the old file's preview and without a hover original.
   */
  #retire(el: HTMLElement): void {
    const parts = this.#parts.get(el)!;
    if (this.#playing?.el === el) this.#stop();
    if (this.#hovered === el) this.#hovered = null;
    if (this.#aimed === el) this.#aimed = null;
    el.hide();
    if (this.#framing && el.dataset.path === this.#framing.path) this.#framing.stop();
    el.removeClasses([TILE, 'is-folder', 'has-cover', 'has-frame', 'is-title-text', ...parts.marks]);
    if (parts.fold) parts.fold.framed = '';
    parts.peeks = [];
    el.removeAttribute('data-path');
    parts.marks = NO_MARKS;
    parts.picture = '';
    this.#tint(el, parts, PLAIN_FACE);
    this.#setPreview(el, '');
  }

  #fill(el: HTMLElement, item: Tile): void {
    const parts = this.#parts.get(el)!;
    const moved = el.dataset.path !== item.path;
    el.addClass(TILE); // a tile from the pool comes without the class
    el.dataset.path = item.path;
    el.toggleClass('is-folder', item.kind === 'folder');
    parts.folder = item.kind === 'folder';
    const face = item.kind === 'folder' ? this.#faceOf(item.path) : PLAIN_FACE;
    this.#fillStub(parts, item.kind === 'folder' ? { ...FOLDER, icon: face.icon } : stubOf(item));
    this.#tint(el, parts, face);
    parts.picture = face.picture ?? '';
    const format = formatOf(item);
    if (parts.badge.textContent !== format) parts.badge.textContent = format;
    const name = item.kind === 'file' ? item.file.name : item.name;
    if (parts.name.textContent !== name) parts.name.textContent = name;
    this.#showPreview(el, item);
    // Under a still mouse the element took another tile: that one plays now, not the old one.
    if (moved && this.#playing?.el === el) this.#stop();
    if (moved && this.#hovered === el) this.#enter(el);
    if (moved && this.#aimed === el) this.#aimed = null; // the mouse was aimed at the old file
  }

  /**
   * Writes the placeholder into the element, only what changed, so scrolling through tiles of one family
   * leaves the DOM alone.
   */
  #fillStub(parts: Parts, stub: Stub): void {
    if (parts.iconId !== stub.icon) {
      setIcon(parts.icon, stub.icon);
      parts.iconId = stub.icon;
    }
    if (parts.format !== stub.format) {
      parts.thumb.toggleClass('mod-format', stub.format);
      parts.format = stub.format;
    }
    if (parts.plate.textContent !== stub.plate) parts.plate.textContent = stub.plate;
    if (parts.color !== stub.color) {
      parts.thumb.setCssProps({ '--buba-format-color': stub.color });
      parts.color = stub.color;
    }
    if (stub.format) this.#fillDoc(parts, stub);
  }

  /**
   * The document silhouette of a file without a picture: its letters ("Ps") or the family icon, and the ink
   * class; the fill is `--buba-format-color` and the type is the label (file-tiles.css). Made on first use,
   * written only on change.
   */
  #fillDoc(parts: Parts, stub: Stub): void {
    const mark = stub.mark ?? '';
    const ink = stub.ink ?? 'theme';
    let doc = parts.doc;
    if (!doc) {
      const root = parts.thumb.createDiv({ cls: 'buba-tile-doc' });
      root.createDiv({ cls: 'buba-doc-ring' }).createDiv();
      root.createDiv({ cls: 'buba-doc-body' });
      root.createDiv({ cls: 'buba-doc-fold' });
      const letters = root.createDiv({ cls: 'buba-doc-letters' });
      const icon = root.createDiv({ cls: 'buba-doc-icon' });
      const label = root.createDiv({ cls: 'buba-doc-label' });
      doc = parts.doc = { root, letters, icon, label, mark: null, drawn: '', ink: '', text: '' };
    }
    if (doc.mark !== mark) {
      doc.mark = mark;
      doc.letters.textContent = mark;
      doc.root.toggleClass('mod-letters', mark !== '');
    }
    // The icon is drawn only while it shows: scrolling through Photoshop files never calls `setIcon`.
    if (mark === '' && doc.drawn !== stub.icon) {
      doc.drawn = stub.icon;
      setIcon(doc.icon, stub.icon);
    }
    if (doc.ink !== ink) {
      if (doc.ink) doc.root.removeClass(`mod-ink-${doc.ink}`);
      doc.ink = ink;
      doc.root.addClass(`mod-ink-${ink}`);
    }
    if (doc.text !== stub.plate) {
      doc.text = stub.plate;
      doc.label.textContent = stub.plate;
    }
  }

  /**
   * Puts the preview or first lines from the store memory into the tile; without them the icon shows until
   * `onReady` brings them.
   */
  #showPreview(el: HTMLElement, item: Tile): void {
    const file = item.kind === 'file';
    const picture = file ? item.path : this.#parts.get(el)!.picture;
    const url = (picture && this.#previews.get(picture)?.url) || '';
    const read = file && excerptable(item.file.ext) ? this.#excerpts.get(item.path) : null;
    // A note read and found without text (only properties, an embed, empty) shows its name on the same text
    // card, so every note looks like a note (word of the owner 27.10: some notes were text, some the icon).
    const title = read === '' && !url;
    const text = title ? stemOf(item.path) : read || '';
    this.#setPreview(el, url, text);
    el.toggleClass('is-title-text', title);
  }

  /**
   * The preview's `blob:` URL goes into the tile picture, first lines as text; with both empty, picture and
   * text are cleared and the icon shows. With a preview or text the tile has `has-preview`: the centered icon
   * and label hide and the corner badge shows.
   */
  #setPreview(el: HTMLElement, url: string, text = ''): void {
    const parts = this.#parts.get(el)!;
    if (parts.url === url && parts.excerpt === text) return;
    if (parts.url !== url) {
      parts.url = url;
      if (url) parts.image.src = url;
      else parts.image.removeAttribute('src');
      this.#average(el, parts);
      this.#frame(el, parts);
    }
    if (parts.excerpt !== text) {
      parts.excerpt = text;
      parts.text.textContent = text;
      el.toggleClass('has-text', text !== '');
    }
    el.toggleClass('has-preview', url !== '' || text !== '');
    // On PSD/AI the preview adds the format to the badge group, and removing it leaves the comment alone.
    // Uses only this tile's shown place: layout hold and scroll stay untouched.
    const index = el.dataset.path === undefined ? undefined : this.#indexOf(el.dataset.path);
    if (index !== undefined && this.#shown.get(index) === el && parts.place)
      this.#fitBadge(el, this.#items[index]!, parts.place);
  }

  /**
   * Tile aspect ratio: the one already known from a preview, else from the stored preview; neither gives 1. A
   * new preview of the same file arrives through `onReady`, which updates the known one.
   */
  #aspect(item: Tile): number {
    if (item.kind !== 'file') return 1;
    const known = this.#knownAspects.get(item.path);
    if (known !== undefined) return known;
    const preview = this.#previews.get(item.path);
    // A file without a picture as a whole-tile silhouette stands in a document-shaped tile (file-tiles.css).
    if (!preview)
      return stubOf(item).format && settingsOf(this.#plugin).fileTile === 'shape' ? DOC_ASPECT : 1;
    const aspect = preview.width / preview.height;
    this.#knownAspects.set(item.path, aspect);
    return aspect;
  }

  #indexOf(path: string): number | undefined {
    if (!this.#indexByPath) {
      this.#indexByPath = new Map();
      this.#items.forEach((item, index) => this.#indexByPath!.set(item.path, index));
    }
    return this.#indexByPath.get(path);
  }

  /**
   * The path's preview is ready: a visible tile gets it at once; a different aspect goes into `#aspects`, and
   * brick rows and columns are recomputed in the next frame, once for everything that arrived in it. On
   * mobile the shown aspect is kept in `#unshown` until that recompute replaces it.
   */
  #previewReady(path: string): void {
    const preview = this.#previews.get(path);
    if (!preview) return;
    // The known aspect is updated for files outside the grid too: otherwise opening their folder would use
    // the old one.
    const aspect = preview.width / preview.height;
    this.#knownAspects.set(path, aspect);
    this.#pictureChanged(path);
    const index = this.#indexOf(path);
    if (index === undefined) return;
    const el = this.#shown.get(index);
    if (el) this.#showPreview(el, this.#items[index]!);
    if (this.#aspectsOf !== this.#items || Math.abs(aspect - (this.#aspects[index] ?? 1)) < 1e-6) return;
    if (Platform.isMobile && !this.#unshown.has(path)) this.#unshown.set(path, this.#aspects[index] ?? 1);
    this.#aspects[index] = aspect;
    this.#reflow();
  }

  /**
   * Recomputes brick rows and columns from previews in the next frame, once for everything that arrived in
   * it. On mobile, while the body scrolls under a finger or by inertia, it waits for the scroll to end:
   * writing `scrollTop` mid-inertia stops iOS momentum, and rows rebuilt on the move jump. Scroll end and
   * touch tail end call it again. Pending content (`#waiting`) also waits; then the frame lays it out and no
   * preview recompute is needed (`#settle`).
   */
  #reflow(): void {
    if (this.#width === 0 || this.#reflowFrame) return;
    if (!byAspects(this.#look.layout) && this.#waiting === null) return;
    if (this.#coasting()) {
      this.#reflowWaits = true;
      return;
    }
    this.#reflowFrame = this.#scroller.win.requestAnimationFrame(() => {
      this.#reflowFrame = 0;
      if (this.#coasting()) this.#reflowWaits = true;
      else if (this.#waiting) this.#settle();
      else if (byAspects(this.#look.layout)) this.#relayout(this.#hold(), true);
    });
  }

  /**
   * Columns hold tiles with an old aspect: when scrolling stops they are recomputed with the new hold
   * boundary.
   */
  #heldColumns(): boolean {
    return this.#held && this.#look.layout === 'waterfall';
  }

  /** A preview recompute or pending content is waiting for the scroll to end. */
  #waits(): boolean {
    return this.#reflowWaits || this.#waiting !== null;
  }

  /**
   * The body stopped: pending content gets one layout, like a content change on a still body, with the top
   * tile held and all arrived aspects; the preview recompute waiting for the same stop is no longer needed.
   */
  #settle(): void {
    const items = this.#waiting!;
    this.#waiting = null;
    this.#reflowWaits = false;
    this.update(items, this.#look, false);
  }

  /**
   * Mobile, and the body is moving: scrolling, a finger on the body, or the touch tail has not passed. Mobile
   * is `Platform.isMobile`, the same check as the `is-mobile` class on `body`.
   */
  #coasting(): boolean {
    return Platform.isMobile && (this.#scrolling || this.#touching || this.#touchTail !== 0);
  }

  readonly #touchStart = (): void => {
    this.#revealed = null;
    this.#touching = true;
    this.#scroller.win.clearTimeout(this.#touchTail);
    this.#touchTail = 0;
  };

  /** Last finger lifted: after the touch tail, a pending recompute or content runs if scrolling stopped. */
  readonly #touchEnd = (event: TouchEvent): void => {
    if (event.touches.length > 0) return; // another finger is still on the body
    this.#touching = false;
    const win = this.#scroller.win;
    win.clearTimeout(this.#touchTail);
    this.#touchTail = win.setTimeout(() => {
      this.#touchTail = 0;
      if (this.#waits()) this.#reflow();
    }, TOUCH_TAIL);
  };

  /**
   * The path's preview was removed, the file is no longer built: a visible tile shows the icon at once
   * instead of the old picture and stays in place without a relayout; the aspect is forgotten so a folder
   * opened later reads it again.
   */
  #previewRemoved(path: string): void {
    this.#knownAspects.delete(path);
    this.#pictureChanged(path);
    const index = this.#indexOf(path);
    const el = index === undefined ? undefined : this.#shown.get(index);
    if (el) this.#showPreview(el, this.#items[index!]!);
  }

  /**
   * What a preview recompute keeps in place: the row of the tile under the mouse, otherwise the first tile of
   * the top visible row, at the same distance from the window top; in columns, the tile itself.
   */
  #hold(): Scroll {
    const top = this.#offset();
    const aimed = this.#aimed?.dataset.path;
    const tile =
      this.#revealedTile() ?? (aimed === undefined ? undefined : this.#indexOf(aimed)) ?? this.#topTile(top);
    if (tile === undefined) return 'keep';
    return { tile, offset: this.#tileTop(tile) - top };
  }

  /**
   * What a content change holds: the first tile of the `#hold` row (in columns, the `#hold` tile itself) by
   * path, taken before the content is replaced; no tiles gives `null`.
   */
  #heldPlace(): TilePlace | null {
    const hold = this.#hold();
    if (typeof hold !== 'object') return null;
    let first: number | undefined;
    if (!this.#model.waterfall) this.#model.tiles(this.#model.rowOf(hold.tile), (index) => (first ??= index));
    const path = this.#items[first ?? hold.tile]?.path;
    return path === undefined ? null : { path, offset: hold.offset };
  }

  /**
   * Whether tiles of the old content `was` that are recognized in the new one keep their order: the content
   * changed by inserts, deletes and renames, not by sorting. Recognized means staying by path, or gone with a
   * name or fingerprint pair (`#pairs`: the open folder or a parent was renamed, a file was renamed).
   * Order-only pairs do not count: a rename that matched no name or fingerprint is treated like a sort and
   * holds the pixel offset. Nothing recognized means nothing to hold: false. Pairs are computed in one pass
   * once the first tile is not found by path.
   */
  #orderKept(was: readonly Tile[]): boolean {
    if (was === this.#items) return true;
    let paired: { to: Int32Array; sure: Uint8Array } | undefined;
    let last = -1;
    for (let at = 0; at < was.length; at += 1) {
      let now = this.#indexOf(was[at]!.path);
      if (now === undefined) {
        if (!paired) {
          const sure = new Uint8Array(was.length);
          paired = { to: this.#pairs(was, sure), sure };
        }
        if (paired.sure[at] === 0) continue;
        now = paired.to[at]!;
      }
      if (now <= last) return false;
      last = now;
    }
    return last >= 0;
  }

  /**
   * The slot before tile `kept` (which tile occupies it in the new content) and where its row top is from the
   * window top. The slot is held, not the tile, the way Obsidian's editor holds the position before the
   * visible line (`mapPos(from, -1)`): whatever took it (a new file before it, or the tile under a new name)
   * stays at the top; at the start of a folder opened from the start, a new file shows first; files renamed
   * before it are replacements and the slot is after them (`#where`). If the tile itself left without a
   * replacement, the next one takes the slot at its place in the old layout `was` (`top` is the body offset
   * in it). No tiles after the slot gives `null`.
   */
  #keptTile(
    was: readonly Tile[],
    kept: TilePlace,
    top: number,
    where: Where,
  ): { tile: number; offset: number } | null {
    const from = was.findIndex((item) => item.path === kept.path);
    if (from < 0) {
      const tile = this.#indexOf(kept.path);
      return tile === undefined ? null : { tile, offset: kept.offset };
    }
    const tile = this.#slot(where, from);
    if (tile === undefined) return null;
    const next = this.#placed(where, from, was.length);
    return next?.tile !== tile || next.from === from
      ? { tile, offset: kept.offset }
      : { tile, offset: this.#tileTop(next.from) - top };
  }

  /**
   * Where tiles of the old content `was` are in the new one, the way Obsidian's editor maps a position
   * through an edit (`mapPos`): a staying tile by path; between neighbouring staying tiles, gone and arrived
   * tiles pair up in order as replacements (a file renamed or moved into the same slot, a renamed folder) and
   * give the arrived index; a gone tile without a replacement gives `undefined`; arrivals beyond the gone
   * ones are new files. Replacements are computed in one pass when the first gone tile is asked for.
   */
  #where(was: readonly Tile[]): Where {
    let pairs: Int32Array | null = null;
    return (at) => {
      const path = was[at]?.path;
      if (path === undefined) return undefined;
      const now = this.#indexOf(path);
      if (now !== undefined) return now;
      pairs ??= this.#pairs(was);
      const to = pairs[at]!;
      return to < 0 ? undefined : to;
    };
  }

  /**
   * Replacements for `#where`: for each gone tile of `was`, the index of the arrived tile in the new content,
   * or -1 if it left without a replacement or stayed. In a gap between neighbouring staying tiles, a gone
   * tile pairs first by path inside the open folder, after the common folder of all content tiles
   * (`set/s1/cover.png` ↔ `moved/s1/cover.png`: with subfolders, same-named files in different subfolders are
   * not mixed up when one of them left). The rest pair by name, the part after the last `/` (a file with its
   * extension, a subfolder by its name): this recognizes files of a renamed open folder or parent; same names
   * pair in order, the first gone with the first free arrival. Then by a fingerprint without the name, `size`
   * and `mtime` as in move detection (a rename in Obsidian does not change the file's `stat`), when it is
   * unique among unpaired gone tiles and among free arrivals. The remainder pairs in order between name or
   * fingerprint pairs, which hold it the way staying tiles hold a gap: an unpaired gone tile takes the first
   * free arrival after its previous such pair and not past the next one; none free there means it left
   * without a replacement. Arrivals beyond the pairs are new files. `sure` marks each gone tile paired by
   * name or fingerprint, which `#orderKept` uses; a pair by path inside the folder counts as a name pair.
   */
  #pairs(was: readonly Tile[], sure?: Uint8Array): Int32Array {
    const out = new Int32Array(was.length).fill(-1);
    const nameOf = (item: Tile): string => item.path.slice(item.path.lastIndexOf('/') + 1);
    // Common folder of all content tiles as its path length with `/`; the path inside the open folder follows
    // it.
    const rootOf = (list: readonly Tile[]): number => {
      let root: string | null = null;
      for (const item of list) {
        const dir = item.path.slice(0, item.path.lastIndexOf('/') + 1);
        if (root === null) root = dir;
        while (!dir.startsWith(root)) root = root.slice(0, root.lastIndexOf('/', root.length - 2) + 1);
        if (root === '') break;
      }
      return root?.length ?? 0;
    };
    const wasRoot = rootOf(was);
    const nowRoot = rootOf(this.#items);
    const printOf = (item: Tile): string | undefined =>
      item.kind === 'file' ? `${item.file.size}:${item.file.mtime}` : undefined;
    let from = 0; // first old tile after the staying one
    let tile = 0; // index after the staying one in the new content
    for (let at = 0; at <= was.length; at += 1) {
      const now = at < was.length ? this.#indexOf(was[at]!.path) : this.#items.length;
      if (now === undefined) continue;
      if (from < at && tile < now) {
        const taken = new Uint8Array(now - tile); // the gap's arrived tile is already paired
        const pair = (gone: number, to: number, known: boolean): void => {
          out[gone] = to;
          taken[to - tile] = 1;
          if (known && sure) sure[gone] = 1;
        };
        // By path inside the open folder: each content tile has its own.
        const inside = new Map<string, number>();
        for (let each = tile; each < now; each += 1) inside.set(this.#items[each]!.path.slice(nowRoot), each);
        for (let gone = from; gone < at; gone += 1) {
          const to = inside.get(was[gone]!.path.slice(wasRoot));
          if (to !== undefined) pair(gone, to, true);
        }
        // By name: free arrivals with this name in order, and how many of them are taken.
        const named = new Map<string, { tiles: number[]; next: number }>();
        for (let each = tile; each < now; each += 1) {
          if (taken[each - tile] === 1) continue;
          const name = nameOf(this.#items[each]!);
          const same = named.get(name);
          if (same) same.tiles.push(each);
          else named.set(name, { tiles: [each], next: 0 });
        }
        for (let gone = from; gone < at; gone += 1) {
          if (out[gone]! >= 0) continue;
          const same = named.get(nameOf(was[gone]!));
          if (same && same.next < same.tiles.length) pair(gone, same.tiles[same.next++]!, true);
        }
        // By fingerprint: unique among unpaired gone tiles and among free arrivals.
        const prints = new Map<string, { gone: number; gones: number; to: number; tos: number }>();
        for (let gone = from; gone < at; gone += 1) {
          const print = out[gone]! < 0 ? printOf(was[gone]!) : undefined;
          if (print === undefined) continue;
          const entry = prints.get(print);
          if (entry) entry.gones += 1;
          else prints.set(print, { gone, gones: 1, to: -1, tos: 0 });
        }
        for (let each = tile; each < now; each += 1) {
          const print = taken[each - tile] === 0 ? printOf(this.#items[each]!) : undefined;
          const entry = print === undefined ? undefined : prints.get(print);
          if (!entry) continue;
          entry.to = each;
          entry.tos += 1;
        }
        for (const entry of prints.values())
          if (entry.gones === 1 && entry.tos === 1) pair(entry.gone, entry.to, true);
        // The remainder pairs in order between name or fingerprint pairs: after the previous one, before the
        // next.
        let free = tile;
        let next = from; // gone tile with the next name or fingerprint pair
        for (let gone = from; gone < at; gone += 1) {
          if (out[gone]! >= 0) {
            free = Math.max(free, out[gone]! + 1);
            continue;
          }
          if (next <= gone) {
            next = gone + 1;
            while (next < at && out[next]! < 0) next += 1;
          }
          const limit = next < at ? out[next]! : now;
          while (free < limit && taken[free - tile] === 1) free += 1;
          if (free < limit) pair(gone, free, false);
        }
      }
      from = at + 1;
      tile = now + 1;
    }
    return out;
  }

  /**
   * The slot of old tile `from` in the new content: after the last tile before it that has a place in the new
   * one (`where` gives staying tiles and replacements), otherwise from the start. New files inserted before
   * it beyond the replacements come after the slot, so they show in it. No tiles after the slot gives
   * `undefined`.
   */
  #slot(where: Where, from: number): number | undefined {
    let tile = 0;
    for (let at = from - 1; at >= 0; at -= 1) {
      const now = where(at);
      if (now === undefined) continue;
      tile = now + 1;
      break;
    }
    return tile < this.#items.length ? tile : undefined;
  }

  /** First old tile from `from` (of `length`) that has a place in the new content: its index in both. */
  #placed(where: Where, from: number, length: number): { from: number; tile: number } | undefined {
    for (let at = from; at < length; at += 1) {
      const tile = where(at);
      if (tile !== undefined) return { from: at, tile };
    }
    return undefined;
  }

  /**
   * First tile of the top visible row at body offset `top`: the row under the body padding; in columns, the
   * lowest tile index whose bottom is below the body padding.
   */
  #topTile(top: number): number | undefined {
    const columns = this.#model.waterfall;
    if (columns) return firstVisible(columns, top);
    let tile: number | undefined;
    const row = this.#virtualizer.getVirtualItemForOffset(top + PAD);
    if (row && row.index < this.#model.rows) this.#model.tiles(row.index, (index) => (tile ??= index));
    return tile;
  }

  /**
   * What the new layout takes from the shown one `was`. The first tile of the top visible row starts a row,
   * so aspects above do not reshuffle what is visible; the row under the mouse (`#aimed`) keeps its tiles
   * with their old aspects. Breaks of the shown layout: new content keeps all of them, so rows above the
   * window keep their height; a preview recompute keeps them from the first visible tiles up to the first new
   * aspect (`keptBreaks`), and the edges of the row held under the mouse only while the mouse is on it.
   * Indices are in the new content (`now` gives staying tiles and replacements, `#where`); a break holds
   * while the same tile or its replacement is before its tile (for the folder's first tile, while it stays
   * first), and the row under the mouse holds while its tiles stay consecutive and no new tile took the slot
   * before it. `above` also keeps the rows above it as shown, from the folder start (`row` then covers them
   * all), while their tiles run consecutively from the first. `pin` is the tile where a content change holds
   * the slot (`#keptTile`): a row starts at it and at the slot before the first visible tile even without the
   * old neighbour before them.
   */
  #keepShown(
    top: number,
    was: Shown,
    now: Where,
    byPreview: boolean,
    above: boolean,
    pin: number | null = null,
  ): { breaks: number[]; holds: number[]; row: HeldRow | null; above: boolean } {
    const carry = (from: readonly number[]): number[] => {
      const out = new Set<number>();
      for (const at of from) {
        const to = now(at);
        if (to !== undefined && (at === 0 ? to === 0 : now(at - 1) === to - 1)) out.add(to);
      }
      return [...out];
    };
    const rows = this.#model.justified ?? [];
    let aimed: number | undefined;
    for (const [index, el] of this.#shown) if (el === this.#aimed) aimed = index;
    const moved = (shown: HeldRow | null): HeldRow | null => {
      const from = shown ? now(shown.start) : undefined;
      if (
        !shown ||
        from === undefined ||
        shown.aspects.some((_, at) => now(shown.start + at) !== from + at) ||
        this.#slot(now, shown.start) !== from
      )
        return null;
      const by = from - shown.start;
      return {
        start: from,
        end: shown.end + by,
        aspects: shown.aspects,
        cuts: shown.cuts.map((at) => at + by),
      };
    };
    const own = aimed === undefined ? null : moved(heldRow(rows, aimed));
    const span = own && above ? moved(heldRow(rows, aimed!, 0)) : null;
    const row = span?.start === 0 ? span : own;
    const holds = row ? [...row.cuts] : [];
    const first = this.#topTile(top);
    if (!byPreview || was.items !== this.#items || first === undefined) {
      const breaks = carry(first === undefined ? was.breaks : [first, ...was.breaks]);
      // The neighbour before the slot was deleted or a new file took the slot: the row still starts at the
      // slot, otherwise visible rows would be laid out from the rows above the window.
      const leads = pin === null ? [] : [pin, first === undefined ? undefined : this.#slot(now, first)];
      for (const lead of leads) if (lead !== undefined && !breaks.includes(lead)) breaks.push(lead);
      return { breaks, holds: [...holds, ...carry(was.holds)], row, above: row !== own };
    }
    const aspectOf = (index: number): number =>
      row && index >= row.start && index < row.end
        ? row.aspects[index - row.start]!
        : (this.#aspects[index] ?? 1);
    return { breaks: keptBreaks(rows, was.breaks, first, aspectOf), holds, row, above: row !== own };
  }

  /**
   * What the new column layout takes from the shown one `was`: tiles up to `upTo` stay as shown, where `upTo`
   * is 1 + the highest tile index fully above the window (`holdUpTo` in core), extended through the tile
   * under the mouse (`#aimed`). Visible tiles with a lower index are held too, so an aspect arriving for a
   * tile above the window in a neighbouring column does not reshuffle what is visible. A tile the window hold
   * keeps with an old aspect (`stale`) stays held even after the window moves up and it becomes visible, as
   * long as at least one tile after it starts before the window bottom; otherwise its aspect would move every
   * visible tile after it. A recompute releases it once it and all later tiles are below the window, and so
   * does a change of view, width or tile size (full relayout). Tiles held only under the mouse are released
   * when the mouse leaves. New content holds only while the first tiles up to the window and mouse boundary
   * are the same files in order (`now` gives staying tiles and replacements, `#where`) and there is something
   * above the window to hold; otherwise it is a full relayout with the top tile kept in place. Held visible
   * tiles run up to the first different file. `top` is the body offset.
   */
  #keepFallen(top: number, was: Fallen, now: Where, byPreview: boolean): FallenKeep | undefined {
    let hold = holdUpTo(was.layout, top - PAD);
    let upTo = hold;
    for (const [index, el] of this.#shown) if (el === this.#aimed) upTo = Math.max(upTo, index + 1);
    const base = upTo;
    if (was.layout.held) {
      const below = startedAbove(was.layout, top + this.#scroller.clientHeight - PAD);
      hold = Math.max(hold, lastBelow(was.stale, below) + 1);
      upTo = Math.max(upTo, hold);
    }
    if (was.items !== this.#items)
      for (let at = 0; at < upTo; at += 1) {
        if (now(at) === at) continue;
        if (at < base) return undefined;
        upTo = at;
        break;
      }
    if (!byPreview && upTo === 0) return undefined;
    return { upTo, from: was.layout, hold: Math.min(hold, upTo) };
  }

  /**
   * The shown columns of `layout` for the next recompute (`Fallen`): which aspect each tile is shown with and
   * which ones the window hold keeps with an old one. `width` is the layout width, `aspects` its aspects,
   * `was` and `keep` the hold if one was taken.
   */
  #shownColumns(
    width: number,
    size: number,
    layout: Waterfall,
    aspects: readonly number[],
    was: Fallen | null,
    keep: FallenKeep | undefined,
  ): Fallen {
    const count = this.#items.length;
    const taken =
      was && keep && keptIn(keep.from, layout) ? Math.min(keep.upTo, count, was.placed.length) : 0;
    const hold = keep ? Math.min(keep.hold, taken) : 0;
    const placed = new Float64Array(count);
    const stale: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const aspect = aspects[index] ?? 1;
      placed[index] = index < taken ? was!.placed[index]! : aspect;
      if (index < hold && !Object.is(placed[index], aspect)) stale.push(index);
    }
    return { items: this.#items, width, size, layout, placed, stale: Int32Array.from(stale) };
  }

  #enter(el: HTMLElement): void {
    this.#hovered = el;
    const path = el.dataset.path;
    const file = path === undefined ? null : this.#vault.getFileByPath(path);
    if (!file || !playsOnHover(file.extension) || this.#playing?.el === el) return;
    this.#stop(); // at most one original plays in the grid
    const video = file.extension.toLowerCase() !== 'gif';
    let media: HTMLVideoElement | HTMLImageElement;
    if (video) {
      const player = createEl('video', { cls: 'buba-tile-media' });
      player.muted = true;
      player.loop = true;
      player.playsInline = true;
      player.autoplay = true;
      media = player;
    } else {
      media = createEl('img', { cls: 'buba-tile-media', attr: { alt: '' } });
    }
    // Above the preview, below the format badge; the preview shows until the original renders a frame.
    this.#parts.get(el)!.image.after(media);
    media.src = this.#vault.getResourcePath(file);
    this.#playing = { el, media, video };
  }

  #leave(el: HTMLElement): void {
    if (this.#hovered === el) this.#hovered = null;
    if (this.#aimed === el) this.#aimed = null;
    if (this.#playing?.el === el) this.#stop();
    if (this.#held) this.#reflow(); // without the hold the layout differs: aspects waited for mouse leave
  }

  /** Mouse left: the original is removed and released, the tile shows the preview again. */
  #stop(): void {
    const playing = this.#playing;
    if (!playing) return;
    this.#playing = null;
    const { media, video } = playing;
    if (video) (media as HTMLVideoElement).pause();
    media.removeAttribute('src');
    // Without load() after removing src, a video keeps its decoder and the file open.
    if (video) (media as HTMLVideoElement).load();
    media.remove();
  }

  #faceOf(path: string): FolderFace {
    return this.#faces?.(path) ?? PLAIN_FACE;
  }

  /** A visible folder tile takes its face: icon, color and picture, only what changed. */
  #face(el: HTMLElement, item: Tile): void {
    const parts = this.#parts.get(el)!;
    const face = this.#faceOf(item.path);
    this.#fillStub(parts, { ...FOLDER, icon: face.icon });
    this.#tint(el, parts, face);
    this.#fold(el, parts, item, face);
    const picture = face.picture ?? '';
    if (parts.picture === picture) return;
    parts.picture = picture;
    this.#showPreview(el, item);
  }

  /**
   * The folder shape over the tile picture (folder-tiles.css): made the first time the element shows a
   * folder; then the name inside, `has-cover` for the folder's own cover, and the peeking cards from the
   * preview store. A card without a preview yet stays hidden until `#pictureChanged`.
   */
  #fold(el: HTMLElement, parts: Parts, item: Tile, face: FolderFace): void {
    let fold = parts.fold;
    if (!fold) {
      const { thumb } = parts;
      thumb.createDiv({ cls: 'buba-fold-back' });
      const deck = thumb.createDiv({ cls: 'buba-fold-peeks' });
      const cards = [0, 1, 2].map(() => {
        const card = deck.createDiv({ cls: 'buba-fold-peek' });
        const image = card.createEl('img', { attr: { alt: '' } });
        const label = card.createSpan({ cls: 'buba-fold-page' });
        return { card, image, label };
      });
      // The front's soft shadow on the files above it, under the front and the cover (folder-tiles.css).
      thumb.createDiv({ cls: 'buba-fold-cast' });
      thumb.createDiv({ cls: 'buba-fold-front' });
      thumb.createDiv({ cls: 'buba-fold-shade' });
      // The selection line: the front's own path stroked in an SVG of the front's size, a stroke of one width
      // on every edge and curve (folder-tiles.css).
      thumb
        .createDiv({ cls: 'buba-fold-front-ring' })
        .createSvg('svg', { attr: { viewBox: FOLD_VIEWBOX, preserveAspectRatio: 'none' } })
        .createSvg('path', { attr: { d: FOLD_PATH, 'vector-effect': 'non-scaling-stroke' } });
      const name = thumb.createDiv({ cls: 'buba-fold-name' });
      fold = parts.fold = { cards, name, shown: ['', '', ''], average: '', frame: null, framed: '' };
    }
    const name = item.kind === 'folder' ? item.name : '';
    if (fold.name.textContent !== name) fold.name.textContent = name;
    el.toggleClass('has-cover', face.cover === true);
    fold.frame = face.frame ?? null;
    parts.peeks = face.peeks ?? [];
    this.#showPeeks(parts);
    this.#average(el, parts);
    this.#frame(el, parts);
  }

  /**
   * A moved cover (`FolderFace.frame`, or the frame being set by "Move cover"): `has-frame`, and the picture as
   * the background of the back plate or the front, placed and sized by the frame (folder-tiles.css); written
   * only on change. Needs the preview's size, so it waits for the preview.
   */
  #frame(el: HTMLElement, parts: Parts): void {
    const fold = parts.fold;
    if (!fold) return;
    const framing =
      this.#framing !== null && this.#framing.path === el.dataset.path ? this.#framing.frame : null;
    const frame = framing ?? fold.frame;
    const preview = (parts.picture && this.#previews.get(parts.picture)) || null;
    const on = frame !== null && el.hasClass('has-cover') && parts.url !== '' && preview !== null;
    if (!on) {
      if (fold.framed !== '') el.removeClass('has-frame');
      fold.framed = '';
      return;
    }
    const aspect = preview.width / preview.height;
    const back = coverSize(aspect, BACK_BOX, frame.zoom);
    const front = coverSize(aspect, FRONT_BOX, frame.zoom);
    const props = {
      '--buba-cover-url': `url("${parts.url}")`,
      '--buba-cover-pos': `${frame.x}% ${frame.y}%`,
      '--buba-cover-back': `${back.w}% ${back.h}%`,
      '--buba-cover-front': `${front.w}% ${front.h}%`,
    };
    const key = Object.values(props).join('|');
    if (fold.framed === key) return;
    fold.framed = key;
    el.addClass('has-frame');
    el.setCssProps(props);
  }

  /**
   * "Move cover" on the shown tile of folder `path`: the tile takes drags and the wheel until Enter, Esc or a
   * press elsewhere (cover-frame.ts); `done` gets the kept frame, or `null` when cancelled. `false` when the
   * grid does not show the folder with its cover.
   */
  frameCover(path: string, done: (frame: CoverFrame | null) => void): boolean {
    const index = this.#indexOf(path);
    const el = index === undefined ? undefined : this.#shown.get(index);
    const parts = el && this.#parts.get(el);
    if (!el || !parts?.fold || !el.hasClass('has-cover')) return false;
    this.#framing?.stop();
    const state = { path, frame: parts.fold.frame ?? MIDDLE, stop: () => {} };
    this.#framing = state;
    const front = () => coverInFront(settingsOf(this.#plugin));
    const shownEl = (): HTMLElement | undefined => {
      const at = this.#indexOf(path);
      const shown = at === undefined ? undefined : this.#shown.get(at);
      return shown?.dataset.path === path ? shown : undefined;
    };
    const aspect = (): number => {
      const preview = this.#previews.get(parts.picture);
      return preview ? preview.width / preview.height : 1;
    };
    state.stop = startFraming(el, state.frame, {
      box: () =>
        shownEl()?.querySelector<HTMLElement>(front() ? '.buba-fold-front' : '.buba-fold-back') ?? null,
      size: (frame) => coverSize(aspect(), front() ? FRONT_BOX : BACK_BOX, frame.zoom),
      apply: (frame) => {
        state.frame = frame;
        const shown = shownEl();
        if (shown) this.#frame(shown, this.#parts.get(shown)!);
      },
      done: (frame) => {
        if (this.#framing === state) this.#framing = null;
        // Drawn with the kept frame until the folder look brings it back from storage.
        if (frame) parts.fold!.frame = frame;
        done(frame);
        const shown = shownEl();
        if (shown) this.#frame(shown, this.#parts.get(shown)!);
      },
    });
    return true;
  }

  /**
   * The folder picture's average color as `--buba-fold-average`, for the back plate behind a cover in front
   * in the cover's color (folder-tiles.css): counted only under those settings, once per preview, from a small
   * copy; the last previews are remembered.
   */
  #average(el: HTMLElement, parts: Parts): void {
    const fold = parts.fold;
    const url = parts.url;
    const settings = settingsOf(this.#plugin);
    if (!fold || fold.average === url || !coverInFront(settings) || settings.folderPlate !== 'cover') return;
    fold.average = url;
    if (!url) return;
    const known = this.#averages.get(url);
    if (known) {
      el.setCssProps({ '--buba-fold-average': known });
      return;
    }
    const probe = createEl('img');
    probe.onload = () => {
      const color = averageColor(probe);
      if (!color) return;
      this.#averages.set(url, color);
      if (this.#averages.size > AVERAGES) this.#averages.delete(this.#averages.keys().next().value!);
      if (parts.url === url) el.setCssProps({ '--buba-fold-average': color });
    };
    probe.src = url;
  }

  /** "Folder cover" or "Behind a cover in front" changed: the shown folders count their colors now. */
  recolor(): void {
    for (const el of this.#shown.values()) this.#average(el, this.#parts.get(el)!);
  }

  /**
   * Cards take a new place without moving there: only hover moves them (word of the owner 26.10: on entering
   * a folder the files inside jumped from the last folder's places). `is-settling` turns their transitions
   * off for two frames, so the new places are drawn as they are.
   */
  #settleCards(deck: HTMLElement | null): void {
    if (!deck || deck.hasClass('is-settling')) return;
    deck.addClass('is-settling');
    const win = deck.win;
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => deck.removeClass('is-settling')));
  }

  /**
   * Cards in the folder: a picture or a document's first page in its own proportions, a document without a
   * preview as a page with its type; a picture whose preview has not come yet waits. Places by the count
   * (`CARD_REST`, `CARD_FAN`), written only on change.
   */
  #showPeeks(parts: Parts): void {
    const fold = parts.fold;
    if (!fold) return;
    const ready = parts.peeks.flatMap(
      (path): { url: string; aspect: number; page: string; color: string }[] => {
        const preview = this.#previews.get(path);
        if (preview)
          return [{ url: preview.url, aspect: preview.width / preview.height || 1, page: '', color: '' }];
        const ext = extOf(path);
        if (previewKind(ext) !== null) return [];
        const page = formatLabel(ext) || ext.toUpperCase();
        return [{ url: '', aspect: PAGE_ASPECT, page, color: colorCss(formatFamily(ext).color) ?? '' }];
      },
    );
    // An empty folder keeps the plain front; the glass is only for files to show through (folder-tiles.css).
    fold.cards[0]?.card.parentElement?.toggleClass('has-cards', ready.length > 0);
    const rest = CARD_REST[ready.length]!;
    const fan = CARD_FAN[ready.length]!;
    fold.cards.forEach(({ card, image, label }, at) => {
      const shown = ready[at];
      const key = shown ? `${shown.url}|${shown.page}|${shown.aspect.toFixed(3)}|${ready.length}` : '';
      if (fold.shown[at] === key) return;
      fold.shown[at] = key;
      this.#settleCards(card.parentElement);
      card.toggleClass('is-shown', shown !== undefined);
      card.toggleClass('is-page', shown !== undefined && shown.url === '');
      if (!shown) {
        image.removeAttribute('src');
        return;
      }
      const width = shown.aspect >= 1 ? CARD_BOX : CARD_BOX * shown.aspect;
      const [rx, ry, rr] = rest[at]!;
      const [fx, fy, fr] = fan[at]!;
      card.setCssProps({
        '--buba-peek-w': `${width.toFixed(1)}%`,
        '--buba-peek-h': `${(width / shown.aspect).toFixed(1)}%`,
        '--buba-peek-x': `${rx}%`,
        '--buba-peek-y': `${ry}%`,
        '--buba-peek-r': `${rr}deg`,
        '--buba-fan-x': `${fx}%`,
        '--buba-fan-y': `${fy}%`,
        '--buba-fan-r': `${fr}deg`,
        '--buba-format-color': shown.color,
      });
      if (shown.url) image.src = shown.url;
      else image.removeAttribute('src');
      if (label.textContent !== shown.page) label.textContent = shown.page;
    });
  }

  /**
   * Folder color on the tile element, as on the tree row: `mod-folder-color`, `--buba-color` and the contrast
   * classes; a file tile and a folder without a color have none.
   */
  #tint(el: HTMLElement, parts: Parts, face: FolderFace): void {
    const tint = face.color ?? '';
    if (parts.tint !== tint) {
      parts.tint = tint;
      el.toggleClass(FOLDER_COLOR, tint !== '');
      el.setCssProps({ '--buba-color': tint });
    }
    for (const cls of LOW_CONTRAST) el.toggleClass(cls, tint !== '' && face.contrast.includes(cls));
  }

  /** A preview came or went for a path that visible folder tiles show as their picture. */
  #pictureChanged(path: string): void {
    for (const [index, el] of this.#shown) {
      const item = this.#items[index];
      if (item?.kind !== 'folder') continue;
      const parts = this.#parts.get(el)!;
      if (parts.picture === path) this.#showPreview(el, item);
      if (parts.peeks.includes(path)) this.#showPeeks(parts);
    }
  }

  #mark(el: HTMLElement, path: string): void {
    const parts = this.#parts.get(el)!;
    const next = [...new Set([...this.#marks.values()].flatMap((marks) => marks(path).filter(isClass)))];
    // Folders never get the comment badge, even if an old file at the same path left a log entry.
    if (parts.folder)
      for (const mark of ['has-comment', 'has-open-comment']) {
        const at = next.indexOf(mark);
        if (at >= 0) next.splice(at, 1);
      }
    if (next.includes('has-comment') && !parts.comment) {
      parts.comment = parts.badges.createSpan({
        cls: 'buba-tile-comment',
        attr: { role: 'img', 'aria-label': t('hasComment') },
      });
      setIcon(parts.comment, 'sticky-note');
    }
    const prev = parts.marks;
    if (next.length === prev.length && next.every((each, at) => each === prev[at])) return;
    el.removeClasses([...prev]);
    el.addClasses([...next]);
    parts.marks = next;
  }
}
