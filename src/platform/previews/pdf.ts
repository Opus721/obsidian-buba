// First PDF page for previews, using Obsidian's own PDF engine (`loadPdfJs`) rather than a bundled pdf.js. On
// desktop the `app://` URL answers `Range` with exactly the slice but with status 200 and no `Accept-Ranges`,
// so pdf.js given a `url` would read the whole file (a 287 MB scan took 6.26 s and 466 MB of memory). Instead
// the file is read in slices by offset: pdf.js requests them from a transport (`PDFDataRangeTransport`), Buba
// reads them via `Range`, at most 32 MB per file. The build settles itself (a 15 s timer, failing the
// transport) because in pdf.js 5.3.34 the transport's `abort()` is empty and `destroy()` does not end a load
// waiting on a silent transport (measured).
import { loadPdfJs } from 'obsidian';
import { readRange, type Fetcher } from './head.ts';

/** Read limit per file: a slice that would push the total past it is not read, and there is no preview. */
export const PDF_READ_MAX = 32 * 1024 * 1024;
/** The build's own timeout, from the start of the build including `loadPdfJs` and worker creation, ms. */
export const PDF_BUILD_MS = 15_000;
/** Max image size inside a page, in pixels: 40 million on desktop, 4096² on phones. */
export const PDF_IMAGE_MAX = 40_000_000;
export const PHONE_PDF_IMAGE_MAX = 4096 * 4096;

/** The parts of Obsidian's pdf.js the build uses: present in 5.3.34 in Obsidian 1.12.4, 1.13.7 and 1.14.4. */
interface PdfJs {
  readonly PDFWorker: new (options: { name: string }) => PdfWorker;
  readonly PDFDataRangeTransport: new (length: number, initialData: Uint8Array | null) => RangeTransport;
  readonly AnnotationMode: { readonly DISABLE: number };
  getDocument(params: Record<string, unknown>): LoadingTask;
}
interface PdfWorker {
  destroy(): unknown;
}
interface RangeTransport {
  requestDataRange(begin: number, end: number): void;
  onDataRange(begin: number, chunk: Uint8Array): void;
}
interface LoadingTask {
  readonly promise: Promise<PdfDocument>;
  destroy(): unknown;
}
interface PdfDocument {
  getPage(number: number): Promise<PdfPage>;
}
interface Viewport {
  readonly width: number;
  readonly height: number;
}
interface PdfPage {
  getViewport(options: { scale: number }): Viewport;
  render(params: Record<string, unknown>): { readonly promise: Promise<unknown>; cancel(): void };
  cleanup(): unknown;
}

/** The PDF whose page is built. */
export interface PdfSource {
  /** File URL, from `vault.getResourcePath`. */
  readonly src: string;
  /** File length, from `file.stat.size`. */
  readonly size: number;
  /**
   * Whether the URL honors offsets: this run's probe (`store.ts`); awaited inside the build, under its timer.
   */
  readonly ranged: () => Promise<boolean>;
  /** Phone: page images up to `PHONE_PDF_IMAGE_MAX`. */
  readonly mobile: boolean;
}

/** Our own "no preview" outcome: the first page needs more than `PDF_READ_MAX` bytes. */
class ReadLimit extends Error {
  override readonly name = 'ReadLimit';
}

/**
 * pdf.js and own outcomes after which this file version has no preview: broken, password-protected, read
 * limit.
 */
const NO_PREVIEW = new Set(['ReadLimit', 'InvalidPDFException', 'PasswordException']);

/** pdf.js cleanup results are neither awaited nor surfaced: they never delay settling. */
function dropped(result: unknown): void {
  if (result instanceof Promise) result.catch(() => undefined);
}

/**
 * Builds first PDF pages with one pdf.js worker per plugin run, created on the first build and removed by
 * `close()` together with the preview store (measured on 250 PDFs: a worker per file took 208 s with 5
 * errors, a shared one 37 s with 0).
 */
export class PdfPages {
  readonly #fetcher: Fetcher;
  #worker: PdfWorker | null = null;
  #closed = false;

  constructor(fetcher: Fetcher) {
    this.#fetcher = fetcher;
  }

  /**
   * Draws page 1 on a canvas at most `side` per side and hands it to `finish` (canvas export), all within one
   * build. `null` means this file version has no preview: broken, password-protected, or the first page needs
   * more than `PDF_READ_MAX`. Throwing is a failure (not stored): the read failed, a slice had the wrong
   * length, 15 s without an answer, or the worker did not start. Every outcome ends the same way: timer
   * cleared, own requests aborted, late slices not passed to pdf.js, `destroy()` of the load and `cancel()`
   * of the render called without waiting, so whatever pdf.js does, the preview queue gets its slot back.
   */
  async firstPage<T>(
    source: PdfSource,
    side: number,
    finish: (canvas: HTMLCanvasElement) => Promise<T>,
  ): Promise<T | null> {
    let fail: (error: unknown) => void = () => undefined;
    const failed = new Promise<never>((_, reject) => (fail = reject));
    failed.catch(() => undefined);
    const timer = window.setTimeout(
      () => fail(new Error(`PDF: build took longer than ${PDF_BUILD_MS} ms`)),
      PDF_BUILD_MS,
    );
    const aborts = new AbortController();
    let settled = false;
    let task: LoadingTask | null = null;
    let drawing: { cancel(): void } | null = null;
    /** The build already settled: no further work, no worker, requests or load. */
    const alive = () => {
      if (settled || this.#closed) throw new Error('PDF: build already finished');
    };
    const work = (async (): Promise<T> => {
      const lib = (await loadPdfJs()) as PdfJs;
      alive();
      this.#worker ??= new lib.PDFWorker({ name: 'buba-previews' });
      const worker = this.#worker;
      const ranged = await source.ranged();
      alive();
      let input: Record<string, unknown>;
      if (ranged) input = this.#ranged(lib, source, () => settled, aborts.signal, fail);
      else {
        // The URL ignores offsets: the whole file is read only if it fits within the read limit.
        if (source.size > PDF_READ_MAX)
          throw new Error(`PDF: URL ignores offset — a file over ${PDF_READ_MAX} bytes is not read`);
        const data = await readRange(this.#fetcher, source.src, 0, source.size, aborts.signal);
        alive();
        input = { data };
      }
      task = lib.getDocument({
        ...input,
        worker,
        isEvalSupported: false,
        enableXfa: false,
        maxImageSize: source.mobile ? PHONE_PDF_IMAGE_MAX : PDF_IMAGE_MAX,
      });
      const doc = await task.promise;
      alive();
      const page = await doc.getPage(1);
      alive();
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: side / Math.max(base.width, base.height, 1) });
      const canvas = createEl('canvas');
      canvas.width = Math.min(side, Math.max(1, Math.round(viewport.width)));
      canvas.height = Math.min(side, Math.max(1, Math.round(viewport.height)));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d canvas context');
      const render = page.render({
        canvas,
        canvasContext: context,
        viewport,
        annotationMode: lib.AnnotationMode.DISABLE,
      });
      drawing = render;
      await render.promise;
      alive();
      dropped(page.cleanup());
      return finish(canvas);
    })();
    try {
      return await Promise.race([work, failed]);
    } catch (error) {
      if (NO_PREVIEW.has((error as { name?: unknown } | null)?.name as string)) return null;
      throw error;
    } finally {
      settled = true;
      window.clearTimeout(timer);
      aborts.abort();
      work.catch(() => undefined); // a late failure after settling is not unhandled
      try {
        (drawing as { cancel(): void } | null)?.cancel();
      } catch {
        // the render already finished
      }
      try {
        dropped((task as LoadingTask | null)?.destroy());
      } catch {
        // pdf.js cleanup never delays settling
      }
    }
  }

  /** The worker goes away with the preview store; builds in progress settle on their own. */
  close(): void {
    this.#closed = true;
    const worker = this.#worker;
    this.#worker = null;
    try {
      dropped(worker?.destroy());
    } catch {
      // the worker is already gone
    }
  }

  /**
   * Reading in slices: the transport counts what was requested; a slice that would push the total past
   * `PDF_READ_MAX` is not read and the build ends with the limit. Each slice is its own `Range` request; a
   * wrong length or a failure fails the whole build.
   */
  #ranged(
    lib: PdfJs,
    source: PdfSource,
    settled: () => boolean,
    signal: AbortSignal,
    fail: (error: unknown) => void,
  ): Record<string, unknown> {
    const fetcher = this.#fetcher;
    let read = 0;
    const Base = lib.PDFDataRangeTransport;
    class Transport extends Base {
      override requestDataRange(begin: number, end: number): void {
        if (settled()) return;
        const length = end - begin;
        if (read + length > PDF_READ_MAX) {
          fail(new ReadLimit(`PDF: the first page needs more than ${PDF_READ_MAX} bytes`));
          return;
        }
        read += length;
        readRange(fetcher, source.src, begin, end, signal).then((chunk) => {
          if (!settled()) this.onDataRange(begin, chunk);
        }, fail);
      }
    }
    return {
      range: new Transport(source.size, null),
      length: source.size,
      disableStream: true,
      disableAutoFetch: true,
    };
  }
}
