// Device preview store: for a file path it builds, in the background, a 512 px preview of an image, a video
// frame, the embedded PSD and AI thumbnail, or the first PDF page (PDFs are read in slices), keeps it in the
// device's IndexedDB (one database per vault) and hands it out as a blob: URL along with the original's size.
// For previews the original is read only here, through getResourcePath, and never handed out as a URL (the
// grid sets video and GIF on hover itself); for PSD and AI only the file start is read. Nothing is written
// into the vault or next to files. Memory, lookup and queue live in `device-previews.ts`; this file holds
// Obsidian, IndexedDB and building.
import { openDB, type DBSchema } from 'idb';
import { Platform, TFile, type App, type Plugin } from 'obsidian';
import { readComposite } from '../../core/format/psd-composite.ts';
import { thumbnailScanner } from '../../core/format/thumbnail.ts';
import { DevicePreviews, PHONE_MEMORY_LIMIT } from './device-previews.ts';
import { frameTimes, isBlackFrame, seekFrame } from './frame.ts';
import { readHead, readRange, readThumbnail, type Fetcher } from './head.ts';
import { PdfPages, type PdfSource } from './pdf.ts';
import {
  composited,
  fitSize,
  phoneReadsHead,
  previewBuilds,
  previewKind,
  previewType,
  previewVersion,
  videoFramePlan,
  type PreviewKind,
  type Size,
  type Stamp,
} from './plan.ts';

/** A tile preview: `url` is the preview's blob: URL, `width` and `height` are the original's size. */
export interface Preview {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export interface PreviewStore {
  /** Preview from memory; `null` if not there yet, in which case ask for it with `want`. */
  get(path: string): Preview | null;
  /**
   * Loads from IndexedDB or builds previews for these paths: the named ones first; this consumer's other
   * pending paths are dropped, other consumers' stay. A consumer is any key (a grid view passes itself);
   * unnamed callers share one consumer. An empty list drops all of the consumer's requests.
   */
  want(paths: readonly string[], consumer?: unknown): void;
  /** The path's preview is ready and in `get`; returns the unsubscribe call. */
  onReady(callback: (path: string) => void): () => void;
  /**
   * The path's preview was removed: the new file version failed to build and `get` no longer has the old one.
   */
  onRemoved(callback: (path: string) => void): () => void;
}

/** A preview record in the database: file version stamp, original size and the preview itself. */
export interface PreviewRecord extends Stamp {
  readonly width: number;
  readonly height: number;
  /**
   * Preview MIME type from `previewType`: WebP except on iPhone; on iPhone PNG for transparent sources, else
   * JPEG.
   */
  readonly type: string;
  /**
   * Build rule version from `previewVersion`; records built before it have no field, which means version 0.
   */
  readonly version?: number;
  readonly data: ArrayBuffer;
}

/** The device preview database; the record key is the file path. */
export interface PreviewBase {
  /** Records for the paths in one read transaction; `undefined` where there is none. */
  read(paths: readonly string[]): Promise<(PreviewRecord | undefined)[]>;
  put(path: string, record: PreviewRecord): Promise<unknown>;
  /** Moves a path's record to the new path in one transaction; does nothing if there is no record. */
  move(from: string, to: string): Promise<unknown>;
  delete(path: string): Promise<unknown>;
  close(): void;
}

/** A vault file as previews see it: extension and version stamp, the same as on `TFile`. */
export interface PreviewFile {
  readonly extension: string;
  readonly stat: Stamp;
}

/** A built preview: the preview image and the original's size. */
export interface BuiltPreview extends Size {
  readonly blob: Blob;
}

/** What the preview store takes from outside. */
export interface PreviewHost {
  /** File by path, from `vault.getFileByPath`; `null` if there is none. */
  file(path: string): PreviewFile | null;
  /**
   * Builds the preview of the file at the path; `null` means this file version has no preview (no embedded
   * thumbnail in a PSD or AI), which the store records in the database; throwing means the build failed.
   */
  build(path: string): Promise<BuiltPreview | null>;
  /**
   * MIME type of the preview built for the file now: a database record of another type is stale. Optional.
   */
  type?(path: string): string | null;
  /**
   * Version of the rule the file's preview is built with now: a record with a lower version is stale.
   * Optional.
   */
  version?(path: string): number;
  /** The device preview database; if it fails to open or errors, previews live only in this run's memory. */
  readonly base: Promise<PreviewBase>;
}

const MAX_SIDE = 512;
const QUALITY = 0.8;
/**
 * How long to wait for an image, video metadata and a video frame before treating the file as unbuildable.
 */
const WAIT_MS = 15000;
const STORE = 'previews';
/** Local storage key: Obsidian prefixes it with the vault id (measured). */
const DATABASE_KEY = 'buba-previews';

interface PreviewSchema extends DBSchema {
  previews: { key: string; value: PreviewRecord };
}

const stores = new WeakMap<Plugin, DevicePreviews>();

/** The window's `fetch`: the file start and the probes are read with it, like an image original. */
const fetchFile: Fetcher = (src, init) => window.fetch(src, init);

/**
 * The preview store, one per plugin instance; plugin unload closes the database and revokes URLs. A preview
 * follows its file like Obsidian's metadata cache: a rename moves the record to the new path, a delete
 * removes it. For a folder Obsidian also sends the event for each of its files, and those are what is
 * handled.
 */
export function previewStore(plugin: Plugin): PreviewStore {
  const known = stores.get(plugin);
  if (known) return known;
  const { vault } = plugin.app;
  // iPhone: whether the file URL honors `Range`; probed once per run, on the first PSD or AI.
  let ranged: Promise<boolean> | null = null;
  // Whether the file URL honors offsets; probed once per run, on the first PDF.
  let offsets: Promise<boolean> | null = null;
  const pdf = new PdfPages(fetchFile);
  const store = new DevicePreviews(
    {
      // Entry for every vault path: a file whose preview is not built on this platform (MKV on iPhone) counts
      // as missing.
      file: (path) => {
        const file = vault.getFileByPath(path);
        return file && previewBuilds(file.extension, Platform.isIosApp) ? file : null;
      },
      type: (path) => {
        const file = vault.getFileByPath(path);
        return file && previewType(file.extension, Platform.isIosApp);
      },
      // The video frame rule is shared by the iPhone and Android apps, but not by desktop mobile emulation.
      version: (path) => {
        const file = vault.getFileByPath(path);
        return file ? previewVersion(file.extension, Platform.isMobileApp) : 0;
      },
      build: async (path) => {
        const file = vault.getFileByPath(path);
        if (!file) throw new Error('no file');
        const type = previewType(file.extension, Platform.isIosApp);
        const kind = previewKind(file.extension);
        if (kind === 'embedded') {
          // A failure, not "no thumbnail": it is not stored, so the file is read again after an Obsidian
          // update.
          if (Platform.isIosApp && !phoneReadsHead(file.stat.size, await (ranged ??= rangeProbe(plugin))))
            throw new Error('file URL on iPhone ignores Range — a file over 64 MB is not read');
          const src = vault.getResourcePath(file);
          // A computer reads the merged picture; without one, or when it cannot be read, the thumbnail.
          if (Platform.isDesktopApp && composited(file.extension)) {
            const merged = await compositePreview(src, file.stat.size, type).catch((error: unknown) => {
              console.warn('Buba: PSD picture not read, the thumbnail is used', file.path, error);
              return null;
            });
            if (merged) return merged;
          }
          return embeddedPreview(src, file.extension, file.stat.size, type);
        }
        if (kind === 'pdf')
          return pdfPreview(
            pdf,
            {
              src: vault.getResourcePath(file),
              size: file.stat.size,
              ranged: () => (offsets ??= offsetProbe(plugin)),
              mobile: Platform.isMobile,
            },
            type,
          );
        return buildPreview(vault.getResourcePath(file), kind, type, Platform.isMobileApp);
      },
      base: openBase(databaseName(plugin.app)),
    },
    // On phones previews build one at a time and fewer are kept in memory.
    Platform.isMobile ? { builds: 1, memory: PHONE_MEMORY_LIMIT } : {},
  );
  stores.set(plugin, store);
  plugin.registerEvent(
    vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile) store.renamed(oldPath, file.path);
    }),
  );
  plugin.registerEvent(
    vault.on('delete', (file) => {
      if (file instanceof TFile) store.deleted(file.path);
    }),
  );
  plugin.register(() => {
    stores.delete(plugin);
    store.close();
    pdf.close();
  });
  return store;
}

/**
 * Database name `buba-previews-<id>`, with a random id written once to the vault's local storage, because
 * `app.appId` is not public API.
 */
function databaseName(app: App): string {
  let id: unknown = app.loadLocalStorage(DATABASE_KEY);
  if (typeof id !== 'string' || !/^[0-9a-f]{16}$/.test(id)) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    app.saveLocalStorage(DATABASE_KEY, id);
  }
  return `buba-previews-${String(id)}`;
}

/** The preview database in the device's IndexedDB: the key is the file path, the value a preview record. */
async function openBase(name: string): Promise<PreviewBase> {
  const db = await openDB<PreviewSchema>(name, 1, {
    upgrade(db) {
      db.createObjectStore(STORE);
    },
  });
  return {
    // One transaction per batch: the grid asks for all visible paths at once, and a transaction per path is
    // slower.
    read(paths) {
      const transaction = db.transaction(STORE, 'readonly');
      return Promise.all(paths.map((path) => transaction.store.get(path)));
    },
    put: (path, record) => db.put(STORE, record, path),
    // One transaction, so an interruption midway neither duplicates nor loses the record.
    async move(from, to) {
      const transaction = db.transaction(STORE, 'readwrite');
      const record = await transaction.store.get(from);
      if (record) await Promise.all([transaction.store.put(record, to), transaction.store.delete(from)]);
      await transaction.done;
    },
    delete: (path) => db.delete(STORE, path),
    close: () => db.close(),
  };
}

/**
 * Whether the file URL on iPhone honors `Range` for any file: a `bytes=0-0` request to the plugin's
 * `manifest.json` via the adapter URL; 206 means yes (Capacitor 6.2.1, 7.1 and newer), anything else or a
 * failure means no. The plugin folder is `manifest.dir`, or `<configDir>/plugins/<id>` without it.
 */
async function rangeProbe(plugin: Plugin): Promise<boolean> {
  const { adapter, configDir } = plugin.app.vault;
  const dir = plugin.manifest.dir ?? `${configDir}/plugins/${plugin.manifest.id}`;
  try {
    return (await readHead(fetchFile, adapter.getResourcePath(`${dir}/manifest.json`), 1, 1)).ranged;
  } catch {
    return false;
  }
}

/**
 * Offset probe bytes in the plugin's `manifest.json`: the middle, not the start, so a from-the-start answer
 * fails.
 */
const PROBE_FROM = 8;
const PROBE_TO = 24;

/**
 * Whether the file URL honors offsets: the plugin's `manifest.json` in full and its slice `bytes=8-23`; a
 * slice of exactly that length with the same bytes as in the whole means yes. The status is not trusted:
 * desktop returns the right slice with 200, old Capacitor on iPhone returns the file from the start, and only
 * the byte comparison catches that. A failure means no: PDFs up to 32 MB are read whole, and after an
 * Obsidian update the next run's probe may pass.
 */
async function offsetProbe(plugin: Plugin): Promise<boolean> {
  const { adapter, configDir } = plugin.app.vault;
  const dir = plugin.manifest.dir ?? `${configDir}/plugins/${plugin.manifest.id}`;
  const src = adapter.getResourcePath(`${dir}/manifest.json`);
  try {
    const response = await fetchFile(src, { cache: 'no-store' });
    if (!response.ok) return false;
    const whole = new Uint8Array(await response.arrayBuffer());
    if (whole.length < PROBE_TO) return false;
    const part = await readRange(fetchFile, src, PROBE_FROM, PROBE_TO);
    return part.every((byte, at) => byte === whole[PROBE_FROM + at]);
  } catch {
    return false;
  }
}

/**
 * First PDF page: the page drawn by Obsidian's pdf.js is redrawn with the same canvas and encoder as the PSD
 * thumbnail, so the database gets preview pixels, not PDF bytes. The record size is the preview size: a PDF
 * page has no pixel size, so the file panel shows no resolution. `null` if there is no preview.
 */
function pdfPreview(pages: PdfPages, source: PdfSource, type: string): Promise<BuiltPreview | null> {
  return pages.firstPage(source, MAX_SIDE, async (canvas) => {
    const fit = { width: canvas.width, height: canvas.height };
    return { blob: await encode(drawn(canvas, fit), type), width: fit.width, height: fit.height };
  });
}

/**
 * Merged PSD or PSB picture, already downscaled by the core reader from the slices it read; drawn and encoded
 * like any preview. `null` if the file has no usable merged picture.
 */
async function compositePreview(src: string, size: number, type: string): Promise<BuiltPreview | null> {
  const merged = await readComposite((begin, end) => readRange(fetchFile, src, begin, end), size, MAX_SIDE);
  if (!merged) return null;
  const context = new OffscreenCanvas(merged.outWidth, merged.outHeight).getContext('2d');
  if (!context) throw new Error('no 2d OffscreenCanvas context');
  context.putImageData(new ImageData(merged.pixels, merged.outWidth, merged.outHeight), 0, 0);
  return { blob: await encode(context, type), width: merged.width, height: merged.height };
}

/**
 * Embedded PSD or AI thumbnail: only the file start is read, the core parser returns a JPEG and the original
 * size; the engine decodes the JPEG like any image and it is redrawn with the same canvas and encoder, so the
 * database gets pixels, not bytes of a foreign file. `null` if there is no thumbnail.
 */
async function embeddedPreview(
  src: string,
  ext: string,
  size: number,
  type: string,
): Promise<BuiltPreview | null> {
  const scan = thumbnailScanner(ext);
  const found = scan && (await readThumbnail(fetchFile, src, size, scan));
  if (!found) return null;
  // A copy on its own ArrayBuffer, which the DOM types require for Blob; a thumbnail is up to 1 MB, usually
  // 2–5 KB.
  const bitmap = await createImageBitmap(new Blob([found.jpeg.slice()], { type: 'image/jpeg' }));
  try {
    const fit = fitSize(bitmap.width, bitmap.height, MAX_SIDE);
    return { blob: await encode(drawn(bitmap, fit), type), width: found.width, height: found.height };
  } finally {
    bitmap.close();
  }
}

function buildPreview(
  src: string,
  kind: PreviewKind | null,
  type: string,
  mobileApp: boolean,
): Promise<BuiltPreview> {
  return kind === 'video' ? videoPreview(src, type, mobileApp) : imagePreview(src, type);
}

/**
 * Image: the original size from the header via <img>, the pixels already downscaled by `createImageBitmap`.
 */
async function imagePreview(src: string, type: string): Promise<BuiltPreview> {
  const response = await window.fetch(src);
  if (!response.ok) throw new Error(`reading original: ${response.status}`);
  const original = await response.blob();
  const { width, height } = await naturalSize(original);
  const fit = fitSize(width, height, MAX_SIDE);
  const bitmap = await createImageBitmap(original, {
    resizeWidth: fit.width,
    resizeHeight: fit.height,
    resizeQuality: 'medium',
  });
  try {
    return { blob: await encode(drawn(bitmap, fit), type), width, height };
  } finally {
    bitmap.close();
  }
}

async function naturalSize(original: Blob): Promise<Size> {
  const url = URL.createObjectURL(original);
  const image = new Image();
  try {
    image.src = url;
    await settled(image, 'load');
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('image has no size');
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    image.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}

/**
 * Video: a frame at the `frameTimes` points per the platform plan (`videoFramePlan`). Desktop: metadata only,
 * a frame at a third of the length but no later than 1 s, drawn on `seeked`. iPhone: WebKit with
 * `preload='metadata'` had not decoded the frame by `seeked` and the preview came out black, so more than
 * metadata is loaded and the frame is drawn once presented (`seekFrame`); a black frame is not a preview, and
 * black at the second point too is a failure, with the tile shown as for an unbuildable file. Android works
 * like iPhone (`mobileApp`): Android WebView 133 with the desktop rule drew an empty transparent frame on
 * `seeked` in 10 of 25 builds (MP4, MOV, MKV, WebM; measured).
 */
async function videoPreview(src: string, type: string, mobileApp: boolean): Promise<BuiltPreview> {
  const plan = videoFramePlan(mobileApp);
  const video = createEl('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = plan.preload;
  // Desktop: the `app://` file URL is not the window's origin, and in Electron 43.7 (Obsidian 1.14.4
  // installer) a non-CORS response is opaque: the frame taints the canvas and `convertToBlob` throws
  // SecurityError. With `crossOrigin` the request uses CORS mode, `app://` answers
  // `Access-Control-Allow-Origin: *`, and the frame is usable on a canvas; Obsidian reads image pixels the
  // same way. The attribute is read at resource selection, so it goes before `src`. iPhone and Android serve
  // the file from the window's own origin, so they do without it.
  if (Platform.isDesktopApp) video.crossOrigin = 'anonymous';
  try {
    video.src = src;
    await settled(video, 'loadedmetadata');
    const { videoWidth: width, videoHeight: height } = video;
    if (!width || !height) throw new Error('video has no frame');
    const fit = fitSize(width, height, MAX_SIDE);
    for (const time of frameTimes(video.duration)) {
      if (plan.awaitFrame) await seekFrame(video, time, WAIT_MS);
      else {
        video.currentTime = time;
        await settled(video, 'seeked');
      }
      const context = drawn(video, fit);
      // Without the black check the preview is the first point, whatever it is: no pixel read, no second
      // point. With it the sample is the preview canvas itself, at most 512×512; a normal frame stops at the
      // first bright pixel.
      if (!plan.rejectBlack || !isBlackFrame(context.getImageData(0, 0, fit.width, fit.height).data)) {
        return { blob: await encode(context, type), width, height };
      }
    }
    throw new Error('video frame is black both at a third and in the middle');
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

/** A preview-sized canvas with the source drawn on it. */
function drawn(
  source: ImageBitmap | HTMLVideoElement | HTMLCanvasElement,
  fit: Size,
): OffscreenCanvasRenderingContext2D {
  const context = new OffscreenCanvas(fit.width, fit.height).getContext('2d');
  if (!context) throw new Error('no 2d OffscreenCanvas context');
  context.drawImage(source, 0, 0, fit.width, fit.height);
  return context;
}

function encode(context: OffscreenCanvasRenderingContext2D, type: string): Promise<Blob> {
  return context.canvas.convertToBlob({ type, quality: QUALITY });
}

/** Waits for event `done`; `error` or silence longer than WAIT_MS rejects. */
function settled(target: HTMLElement, done: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error(`no "${done}" in ${WAIT_MS} ms`)), WAIT_MS);
    const onDone = () => finish();
    const onError = () => finish(new Error(`error instead of "${done}"`));
    function finish(error?: Error): void {
      window.clearTimeout(timer);
      target.removeEventListener(done, onDone);
      target.removeEventListener('error', onError);
      if (error) reject(error);
      else resolve();
    }
    target.addEventListener(done, onDone);
    target.addEventListener('error', onError);
  });
}
