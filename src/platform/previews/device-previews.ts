// The device preview store without Obsidian or IndexedDB: memory, database lookup, the build queue, and
// records that follow their file. Vault files, the database and the builder are injected per the contract in
// `store.ts`: `previewStore` passes the real ones, the test passes fakes. Nothing comes from `obsidian`; the
// test runs in node.
import { isStale, previewKind, PreviewQueue, UNNAMED, type Stamp } from './plan.ts';
import type { Preview, PreviewBase, PreviewFile, PreviewHost, PreviewRecord, PreviewStore } from './store.ts';

/**
 * How many previews to keep in memory: beyond this the least recently asked are evicted (their `url` is
 * revoked).
 */
const MEMORY_LIMIT = 2000;

/**
 * Phone memory limit. A PNG preview of a photographic image weighs up to 370 KB (measured: 12 MP with camera
 * noise, 512 px): 2000 of them exceed 700 MB against iPhone's roughly 600 MB headroom, while 500 take about
 * 180 MB.
 */
export const PHONE_MEMORY_LIMIT = 500;

/** Store limits; when omitted, two builds at once and `MEMORY_LIMIT` previews in memory, as on desktop. */
export interface PreviewLimits {
  /** How many previews build at once: one on phones. */
  readonly builds?: number;
  /** How many previews to keep in memory. */
  readonly memory?: number;
}

/**
 * Record type for "no thumbnail": this version of a PSD or AI file has no embedded thumbnail (the build
 * returned `null`); no data, only the file version stamp. After a restart such a file is not read again until
 * it changes; for a path whose preview is an image or video such a record is stale. Older builds (0.5.0)
 * ignore it: they do not look up PSD and AI paths, and treat a record of another type for an image as stale.
 */
const NO_THUMBNAIL = '';

/** Previews are built by path extension: a name without a preview kind is never in the database. */
function previewable(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > -1 && previewKind(name.slice(dot + 1)) !== null;
}

export class DevicePreviews implements PreviewStore {
  readonly #host: PreviewHost;
  readonly #queue: PreviewQueue;
  readonly #memoryLimit: number;
  /** Insertion order is eviction order: a path asked for again moves to the end. */
  readonly #memory = new Map<string, { readonly preview: Preview; readonly stamp: Stamp }>();
  /** IndexedDB has no fresh preview for this file version: build it rather than look it up again. */
  readonly #missing = new Map<string, Stamp>();
  /** Build failed or there is no thumbnail for this file version: do not retry until the file changes. */
  readonly #failed = new Map<string, Stamp>();
  readonly #lookups = new Map<string, Promise<void>>();
  readonly #ready = new Set<(path: string) => void>();
  readonly #removed = new Set<(path: string) => void>();
  /** What each consumer currently asks for: such entries are never evicted. */
  readonly #wanted = new Map<unknown, Set<string>>();
  #closed = false;

  constructor(host: PreviewHost, limits: PreviewLimits = {}) {
    this.#host = host;
    this.#queue = new PreviewQueue((path) => this.#load(path), limits.builds);
    this.#memoryLimit = limits.memory ?? MEMORY_LIMIT;
    host.base.catch((error: unknown) => console.warn("Buba: preview database didn't open", error));
  }

  get(path: string): Preview | null {
    return this.#memory.get(path)?.preview ?? null;
  }

  want(paths: readonly string[], consumer: unknown = UNNAMED): void {
    if (this.#closed) return;
    const wanted = new Set<string>();
    const queued: string[] = [];
    const unknown: string[] = [];
    for (const path of paths) {
      const file = this.#file(path);
      if (!file || wanted.has(path)) continue;
      wanted.add(path);
      const entry = this.#memory.get(path);
      if (entry && !isStale(entry.stamp, file.stat)) {
        this.#memory.delete(path);
        this.#memory.set(path, entry);
        continue;
      }
      // A stale preview stays in `get` until a new one replaces it, so the tile does not flash a placeholder.
      if (!isStale(this.#failed.get(path), file.stat)) continue;
      queued.push(path);
      if (!this.#lookups.has(path) && isStale(this.#missing.get(path), file.stat)) unknown.push(path);
    }
    if (wanted.size) this.#wanted.set(consumer, wanted);
    else this.#wanted.delete(consumer);
    if (unknown.length) {
      const lookup = this.#lookup(unknown);
      for (const path of unknown) this.#lookups.set(path, lookup);
    }
    this.#queue.want(queued, consumer);
  }

  onReady(callback: (path: string) => void): () => void {
    this.#ready.add(callback);
    return () => this.#ready.delete(callback);
  }

  onRemoved(callback: (path: string) => void): () => void {
    this.#removed.add(callback);
    return () => this.#removed.delete(callback);
  }

  /**
   * A file was renamed or moved: its preview follows it, like Obsidian's metadata cache. The memory and
   * database record move to the new path, the file stamp stays the same, and nothing is rebuilt. `onReady`
   * listeners hear the new path: anyone who called `get` before the move got `null`. A new name without a
   * preview kind drops the record, as on deletion.
   */
  renamed(from: string, to: string): void {
    if (this.#closed || from === to || !previewable(from)) return;
    if (!previewable(to)) return this.deleted(from);
    const extension = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    if (extension(from) !== extension(to)) {
      this.deleted(from);
      this.deleted(to);
      this.#announce(this.#removed, to, 'removal');
      return;
    }
    const entry = this.#memory.get(from);
    this.#forget(to);
    this.#memory.delete(from);
    if (entry) this.#memory.set(to, entry);
    for (const marks of [this.#missing, this.#failed]) {
      const stamp = marks.get(from);
      marks.delete(from);
      if (stamp) marks.set(to, stamp);
    }
    for (const paths of this.#wanted.values()) if (paths.delete(from)) paths.add(to);
    this.#write((base) => base.move(from, to), `not moved in IndexedDB — ${from} → ${to}`);
    if (entry) this.#announce(this.#ready, to, 'ready');
  }

  /** A file was deleted: its preview leaves memory and the device database. */
  deleted(path: string): void {
    if (this.#closed || !previewable(path)) return;
    this.#forget(path);
    this.#write((base) => base.delete(path), `not deleted from IndexedDB — ${path}`);
  }

  close(): void {
    this.#closed = true;
    this.#queue.clear();
    for (const { preview } of this.#memory.values()) URL.revokeObjectURL(preview.url);
    this.#memory.clear();
    this.#ready.clear();
    this.#removed.clear();
    this.#host.base.then((base) => base.close()).catch(() => undefined);
  }

  #file(path: string): PreviewFile | null {
    const file = this.#host.file(path);
    return file && previewKind(file.extension) ? file : null;
  }

  /** Forgets everything about a path in memory; the preview `url` is revoked. */
  #forget(path: string): void {
    const entry = this.#memory.get(path);
    if (entry) URL.revokeObjectURL(entry.preview.url);
    this.#memory.delete(path);
    this.#missing.delete(path);
    this.#failed.delete(path);
    for (const paths of this.#wanted.values()) paths.delete(path);
  }

  /** Database writes happen in call order: IndexedDB transactions run in creation order. */
  #write(task: (base: PreviewBase) => Promise<unknown>, failure: string): void {
    this.#host.base.then(task).catch((error: unknown) => console.warn(`Buba: preview ${failure}`, error));
  }

  /** One transaction for the whole batch: fresh previews go to memory, the rest get built. */
  async #lookup(paths: readonly string[]): Promise<void> {
    let records: (PreviewRecord | undefined)[] = [];
    try {
      records = await (await this.#host.base).read(paths);
    } catch (error) {
      console.warn('Buba: previews not read from IndexedDB', error);
    }
    paths.forEach((path, at) => {
      // While a lookup for a path is running no other is started (`want`), so this record is its and only
      // its.
      this.#lookups.delete(path);
      const file = this.#file(path);
      if (!file) return;
      const record = records[at];
      const stamp: Stamp = { mtime: file.stat.mtime, size: file.stat.size };
      const current =
        record && !isStale(record, file.stat) && (record.version ?? 0) >= (this.#host.version?.(path) ?? 0);
      // "No thumbnail" for this PSD or AI version, "no preview" for a PDF: do not build again; for images and
      // videos such a record is stale.
      if (current && record.type === NO_THUMBNAIL) {
        const kind = previewKind(file.extension);
        if (kind === 'embedded' || kind === 'pdf') this.#failed.set(path, stamp);
        else this.#missing.set(path, stamp);
        return;
      }
      // A record of a different type than the source needs now, or of a lower version, was built by an older
      // rule: JPEG of a transparent image on iPhone, a video frame drawn before decoding.
      const expected = this.#host.type?.(path);
      if (current && (!expected || record.type === expected)) this.#show(path, record);
      else this.#missing.set(path, stamp);
    });
  }

  /**
   * Queue task: wait for the IndexedDB lookup and, if nothing was found, build the preview and save it. If
   * the lookup found "no thumbnail" for this file version, do not build.
   */
  async #load(path: string): Promise<void> {
    await this.#lookups.get(path);
    const file = this.#file(path);
    const entry = this.#memory.get(path);
    if (this.#closed || !file || (entry && !isStale(entry.stamp, file.stat))) return;
    if (!isStale(this.#failed.get(path), file.stat)) return;
    const stamp: Stamp = { mtime: file.stat.mtime, size: file.stat.size };
    const version = this.#host.version?.(path) ?? 0;
    let record: PreviewRecord;
    try {
      const built = await this.#host.build(path);
      // No thumbnail in the file is a normal outcome, not a failure: a database mark, no console warning.
      if (!built) {
        const none = { ...stamp, width: 0, height: 0, type: NO_THUMBNAIL, version, data: new ArrayBuffer(0) };
        this.#notBuilt(path, stamp, none);
        return;
      }
      record = {
        ...stamp,
        width: built.width,
        height: built.height,
        type: built.blob.type,
        version,
        data: await built.blob.arrayBuffer(),
      };
    } catch (error) {
      console.warn(`Buba: preview not built — ${path}`, error);
      this.#notBuilt(path, stamp);
      return;
    }
    // Renamed or deleted while building: no record goes to the old path, since its move already happened.
    if (this.#closed || !this.#file(path)) return;
    this.#show(path, record);
    try {
      await (await this.#host.base).put(path, record);
    } catch (error) {
      console.warn(`Buba: preview not saved in IndexedDB — ${path}`, error);
    }
  }

  /**
   * This file version failed to build or has no thumbnail: do not retry until it changes, and drop the
   * previous version's preview from memory and database, otherwise the panel would show an image and
   * resolution the file no longer has. `onRemoved` listeners hear the path if the preview was in `get`.
   * `none` is the "no thumbnail" record: it replaces the old one in the database, so the file is not read
   * again after a restart; a build failure is not written, so it retries on the next run.
   */
  #notBuilt(path: string, stamp: Stamp, none?: PreviewRecord): void {
    const file = this.#file(path);
    if (this.#closed || !file) return;
    this.#failed.set(path, stamp);
    const entry = this.#memory.get(path);
    if (entry && !isStale(entry.stamp, file.stat)) return;
    this.#memory.delete(path);
    if (none) this.#write((base) => base.put(path, none), `"no thumbnail" not saved in IndexedDB — ${path}`);
    else this.#write((base) => base.delete(path), `not deleted from IndexedDB — ${path}`);
    if (!entry) return;
    URL.revokeObjectURL(entry.preview.url);
    this.#announce(this.#removed, path, 'removal');
  }

  #show(path: string, record: PreviewRecord): void {
    if (this.#closed) return;
    const old = this.#memory.get(path);
    if (old) URL.revokeObjectURL(old.preview.url);
    this.#memory.delete(path);
    const url = URL.createObjectURL(new Blob([record.data], { type: record.type }));
    this.#memory.set(path, {
      preview: { url, width: record.width, height: record.height },
      stamp: { mtime: record.mtime, size: record.size },
    });
    this.#missing.delete(path);
    this.#failed.delete(path);
    this.#trim();
    this.#announce(this.#ready, path, 'ready');
  }

  #announce(listeners: ReadonlySet<(path: string) => void>, path: string, what: string): void {
    for (const listener of listeners) {
      try {
        listener(path);
      } catch (error) {
        console.error(`Buba: preview ${what} listener failed`, error);
      }
    }
  }

  /** Over the limit, evicts the oldest entries no consumer currently asks for. */
  #trim(): void {
    const wanted = [...this.#wanted.values()];
    for (const [path, { preview }] of this.#memory) {
      if (this.#memory.size <= this.#memoryLimit) return;
      if (wanted.some((paths) => paths.has(path))) continue;
      URL.revokeObjectURL(preview.url);
      this.#memory.delete(path);
    }
  }
}
