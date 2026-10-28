// The pure part of the preview store, without importing obsidian: what gets a preview, at what size, when to
// rebuild and in which order to build.
import { thumbnailScanner } from '../../core/format/thumbnail.ts';

/** An image, a video frame, the embedded PSD and AI thumbnail, or the first PDF page. */
export type PreviewKind = 'image' | 'video' | 'embedded' | 'pdf';

// SVG is only shown through <img>; no preview is built for it, for security.
const IMAGES = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']);
// Obsidian opens MKV itself (`VIDEO_EXTS`) and the window's engine reads Matroska with H.264, VP9 and AV1, so
// frame and hover work as for MP4. Video the engine cannot decode (HEVC without a hardware decoder, ProRes)
// stays without a frame, like an MP4 without one: a video icon and "MKV" in the tile corner.
const VIDEOS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv']);

/**
 * What a preview is built from, by case-insensitive extension: an image, a video frame, an embedded
 * thumbnail, the first PDF page, or nothing. Thumbnails are for extensions the thumbnail parser knows
 * (`thumbnailScanner`): PSD, PSB, AI and AIT. EPS gets a badge: its preview is TIFF or WMF in a DOS header, a
 * different format.
 */
export function previewKind(ext: string): PreviewKind | null {
  const lower = ext.toLowerCase();
  if (IMAGES.has(lower)) return 'image';
  if (VIDEOS.has(lower)) return 'video';
  if (thumbnailScanner(lower)) return 'embedded';
  if (lower === 'pdf') return 'pdf';
  return null;
}

/**
 * Whether a tile shows the file's first lines as text: notes and text files, any case. This is not a preview
 * kind: file text is never written to the preview database (it holds pixels only) and lives in run memory
 * (`excerpts.ts`).
 */
export function excerptable(ext: string): boolean {
  const lower = ext.toLowerCase();
  return lower === 'md' || lower === 'txt';
}

/**
 * On iPhone, if the file URL ignores `Range`, larger files are not read. Capacitor's file handler in
 * 4.0–6.2.0 and 7.0.x honors `Range` only for video and audio and reads anything else into app memory whole,
 * so asking for the start of a 500 MB PSD could crash Obsidian (judged from the handler code, not measured on
 * iPhone). A PNG original is read whole on phones today as well; lower this one constant if iPhone
 * measurements show it is still too much.
 */
export const PHONE_WHOLE_READ_MAX = 64 * 1024 * 1024;

/**
 * Whether to read the start of a `size`-byte file on iPhone: if the URL honors `Range` (`ranged`, the probe
 * got 206) any file is read since the whole file never lands in memory; otherwise only files up to
 * `PHONE_WHOLE_READ_MAX`.
 */
export function phoneReadsHead(size: number, ranged: boolean): boolean {
  return ranged || size <= PHONE_WHOLE_READ_MAX;
}

/**
 * Sources that may carry transparency: their iPhone preview is PNG, as JPEG has none; PSD and AI thumbnails
 * have none.
 */
const CLEAR = new Set(['png', 'gif', 'webp', 'avif', 'bmp']);

/**
 * Preview MIME type by source extension, without reading pixels. WebP everywhere but iPhone. On iPhone Safari
 * cannot encode WebP from a canvas (WebKit bug 219977) and JPEG has no transparency, so sources that may
 * carry it get PNG, the rest and video frames get JPEG; the theme color is never baked into a preview.
 */
export function previewType(ext: string, ios: boolean): string {
  if (!ios) return 'image/webp';
  return CLEAR.has(ext.toLowerCase()) ? 'image/png' : 'image/jpeg';
}

/**
 * What iPhone cannot open: WebKit accepts only WebM from Matroska, and AVFoundation does not read Matroska.
 */
const IOS_UNREADABLE = new Set(['mkv']);

/**
 * Whether a file's preview is built on this platform. On iPhone MKV is not: it is not looked up in the
 * database, not built and not logged (not measured on iPhone); tile and panel draw a video icon without a
 * frame for kind `video`. Everything else, and everything on desktop, builds if it has a preview kind
 * (`previewKind`). Desktop mobile emulation does not take the iPhone branch (`Platform.isIosApp` is false
 * there).
 */
export function previewBuilds(ext: string, ios: boolean): boolean {
  if (ios && IOS_UNREADABLE.has(ext.toLowerCase())) return false;
  return previewKind(ext) !== null;
}

/**
 * Version of the video frame rule in the phone app: the previous rule drew the frame on `seeked`, before the
 * engine decoded it, and left black previews on iPhone and empty transparent ones on Android in the database.
 */
export const VIDEO_FRAME_VERSION = 1;

/**
 * Version of the PSD and PSB rule on a computer: the merged image (src/core/format/psd-composite.ts) instead
 * of Photoshop's 160 px thumbnail, which stays the fallback and the rule on phones.
 */
export const PSD_COMPOSITE_VERSION = 1;

/** Whether a computer builds the file's preview from the merged image: PSD and PSB, any case. */
export function composited(ext: string): boolean {
  const lower = ext.toLowerCase();
  return lower === 'psd' || lower === 'psb';
}

/**
 * Version of the rule a file's preview is built with now: a database record with a lower version was built by
 * an older rule and is rebuilt once, and the new record carries the current version. Raised for video frames
 * in the phone app (`mobileApp`: iPhone and Android, `Platform.isMobileApp`) and for PSD and PSB on a
 * computer; everything else is 0, like records without a version, so images are not rebuilt.
 */
export function previewVersion(ext: string, mobileApp: boolean): number {
  if (mobileApp) return previewKind(ext) === 'video' ? VIDEO_FRAME_VERSION : 0;
  return composited(ext) ? PSD_COMPOSITE_VERSION : 0;
}

/** How a video frame preview is built: what to load and when the frame at a point is taken. */
export interface VideoFramePlan {
  /** The video's `preload`. */
  readonly preload: 'metadata' | 'auto';
  /**
   * Wait for the decoded frame to be presented after seeking (`seekFrame` in `frame.ts`); otherwise draw on
   * `seeked`.
   */
  readonly awaitFrame: boolean;
  /**
   * A black frame is not a preview: try the next `frameTimes` point, fail if all are black; otherwise take
   * the first.
   */
  readonly rejectBlack: boolean;
}

/**
 * Video frame plan by platform. Desktop: metadata only, the first point's frame on `seeked`, no black check
 * and no second point; waiting for presentation is expensive there: in a hidden window presentation never
 * comes and every video waits for the fallback limit, and `auto` reads 2–4 times more (measured in Electron
 * 37). Phone app (`mobileApp`): on iPhone WebKit had not decoded the frame by `seeked` (WebKit bug 236604)
 * and previews came out black; on Android WebView 133 drew an empty transparent frame on `seeked` in 10 of 25
 * builds (measured; a transparent frame is RGB 0, i.e. black). So: `auto`, wait for presentation, a black
 * frame is not a preview. Desktop mobile emulation does not take this branch (`Platform.isMobileApp` is false
 * there).
 */
export function videoFramePlan(mobileApp: boolean): VideoFramePlan {
  return mobileApp
    ? { preload: 'auto', awaitFrame: true, rejectBlack: true }
    : { preload: 'metadata', awaitFrame: false, rejectBlack: false };
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Preview size: the long side at most `max`, aspect ratio kept, smaller images are not enlarged. */
export function fitSize(width: number, height: number, max = 512): Size {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** What ties a preview to a file version: modification time and size. */
export interface Stamp {
  readonly mtime: number;
  readonly size: number;
}

/** A saved preview is stale if missing or if the file's modification time or size differ. */
export function isStale(saved: Stamp | null | undefined, stat: Stamp): boolean {
  return !saved || saved.mtime !== stat.mtime || saved.size !== stat.size;
}

/** Callers that do not name themselves in `want` all count as one consumer. */
export const UNNAMED: unique symbol = Symbol('unnamed');

/** One consumer's pending paths: its order and when it last got a slot (0 if never). */
interface Line {
  readonly paths: string[];
  served: number;
}

/** The non-empty line that has waited longest for a slot; on a tie, the first in order. */
function nextLine<T extends Line>(lines: Iterable<T>): T | undefined {
  let best: T | undefined;
  for (const line of lines) if (line.paths.length && (!best || line.served < best.served)) best = line;
  return best;
}

/**
 * Build queue: at most `limit` tasks at once. Pending paths are kept per consumer (grid, file panel): a
 * consumer's last `want` sets the order of its own paths and never drops another's. A free slot goes to
 * whoever has waited longest for one, in turn, as in fair queuing, so one file panel tile does not wait
 * behind the whole visible grid. A path is built once however many consumers ask for it. A started task runs
 * to the end even if the path is no longer named: its result lands in the store.
 */
export class PreviewQueue {
  readonly #run: (path: string) => Promise<unknown>;
  readonly #limit: number;
  readonly #running = new Set<string>();
  /** Non-empty consumer lines in order of appearance: on a tie the slot goes to the earlier one. */
  readonly #lines = new Map<unknown, Line>();
  #tick = 0;

  constructor(run: (path: string) => Promise<unknown>, limit = 2) {
    this.#run = run;
    this.#limit = limit;
  }

  /**
   * Puts the named paths first in the consumer's line, in this order; its not-yet-started paths that are not
   * named are dropped. An empty list drops all of its pending paths.
   */
  want(paths: readonly string[], consumer: unknown = UNNAMED): void {
    const named = new Set<string>();
    const mine = paths.filter((path) => {
      if (named.has(path) || this.#running.has(path)) return false;
      named.add(path);
      return true;
    });
    const line = this.#lines.get(consumer);
    if (!mine.length) this.#lines.delete(consumer);
    else if (line) line.paths.splice(0, line.paths.length, ...mine);
    else this.#lines.set(consumer, { paths: mine, served: 0 });
    this.#pump();
  }

  /** Drops everything pending for everyone; started tasks finish. */
  clear(): void {
    this.#lines.clear();
  }

  get running(): string[] {
    return [...this.#running];
  }

  /** Pending paths in the order they will start if nothing changes. */
  get waiting(): string[] {
    const lines = [...this.#lines.values()].map((line) => ({ paths: [...line.paths], served: line.served }));
    const order = new Set<string>();
    let tick = this.#tick;
    for (;;) {
      // A started path is removed from everyone waiting for it.
      for (const line of lines) while (line.paths.length && order.has(line.paths[0]!)) line.paths.shift();
      const line = nextLine(lines);
      if (!line) return [...order];
      order.add(line.paths.shift()!);
      line.served = ++tick;
    }
  }

  /** First path of whoever has waited longest for a slot; the same path is removed from the others. */
  #next(): string | undefined {
    const line = nextLine(this.#lines.values());
    if (!line) return undefined;
    const path = line.paths.shift()!;
    line.served = ++this.#tick;
    for (const [consumer, other] of this.#lines) {
      const at = other.paths.indexOf(path);
      if (at > -1) other.paths.splice(at, 1);
      if (!other.paths.length) this.#lines.delete(consumer);
    }
    return path;
  }

  #pump(): void {
    while (this.#running.size < this.#limit) {
      const path = this.#next();
      if (path === undefined) return;
      this.#running.add(path);
      let task: Promise<unknown>;
      try {
        task = this.#run(path);
      } catch (error) {
        task = Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      void task
        .catch(() => undefined)
        .finally(() => {
          this.#running.delete(path);
          this.#pump();
        });
    }
  }
}
