// First lines of MD and TXT files on tiles: the file start is the first 8 KB via `Range` from byte 0, like
// the PSD start (`head.ts`), 64 KB when 8 KB give no text, the vault's `cachedRead` when the URL fails;
// cleanup is in core (src/core/format/excerpt.ts). Note text is file content, and only pixels go to the
// preview database, so first lines live only in this run's memory. Reads go through a bounded queue, like
// preview builds, and arrivals are announced in batches at most once per frame: when every read was its own
// `fetch` without a queue and called the grid separately, the median frame took 33 ms instead of 16.7
// (measured).
import { Platform, type Plugin } from 'obsidian';
import { excerptOf } from '../../core/format/excerpt.ts';
import { readHead, type Fetcher } from './head.ts';
import { excerptable, isStale, phoneReadsHead, PreviewQueue, UNNAMED, type Stamp } from './plan.ts';

/** How many bytes of the file start are read. */
export const EXCERPT_HEAD = 8 * 1024;
/**
 * A longer start, read once when the first `EXCERPT_HEAD` bytes clean to nothing: a web clip can open with
 * long properties or a run of pictures, and its text starts further down.
 */
export const EXCERPT_MORE = 64 * 1024;
/**
 * A file the file URL could not give is read through the vault (`cachedRead`, as Obsidian reads notes) up to
 * this size; a bigger one keeps its icon.
 */
export const EXCERPT_VAULT_MAX = 4 * 1024 * 1024;
/** How many texts to keep in memory; fewer on phones, as for previews (`device-previews.ts`). */
export const EXCERPT_MEMORY = 2000;
export const PHONE_EXCERPT_MEMORY = 500;

export interface ExcerptStore {
  /**
   * First lines from memory: `''` if the file has none, `null` if not read yet; after a file edit, the old
   * ones until re-read.
   */
  get(path: string): string | null;
  /** Reads first lines for these paths; this consumer's pending paths not named here are dropped. */
  want(paths: readonly string[], consumer?: unknown): void;
  /** A path's first lines arrived or changed, batched once per frame; returns the unsubscribe call. */
  onReady(callback: (path: string) => void): () => void;
}

/** What the first lines store takes from outside. */
export interface ExcerptHost {
  /** The file at the path if it can have first lines, otherwise `null`. */
  file(path: string): { readonly extension: string; readonly stat: Stamp } | null;
  /** At most `limit` bytes of the file start; throws on failure. */
  read(path: string, limit: number): Promise<Uint8Array>;
  /** Calls `run` on the next frame. */
  frame(run: () => void): void;
}

/** Limits: concurrent reads and texts in memory. */
export interface ExcerptLimits {
  readonly reads?: number;
  readonly memory?: number;
}

export class Excerpts implements ExcerptStore {
  readonly #host: ExcerptHost;
  readonly #queue: PreviewQueue;
  readonly #memoryLimit: number;
  /** Insertion order is eviction order: a path asked for again moves to the end. */
  readonly #memory = new Map<string, { readonly stamp: Stamp; readonly text: string }>();
  /** Reading this file version failed: do not retry until the file changes. */
  readonly #failed = new Map<string, Stamp>();
  /** What each consumer currently asks for: such entries are never evicted. */
  readonly #wanted = new Map<unknown, Set<string>>();
  readonly #ready = new Set<(path: string) => void>();
  /** Arrivals in this frame. */
  readonly #arrived = new Set<string>();
  #framed = false;

  constructor(host: ExcerptHost, limits: ExcerptLimits = {}) {
    this.#host = host;
    this.#queue = new PreviewQueue((path) => this.#load(path), limits.reads ?? 2);
    this.#memoryLimit = limits.memory ?? EXCERPT_MEMORY;
  }

  get(path: string): string | null {
    return this.#memory.get(path)?.text ?? null;
  }

  want(paths: readonly string[], consumer: unknown = UNNAMED): void {
    const wanted = new Set<string>();
    const queued: string[] = [];
    for (const path of paths) {
      const file = this.#host.file(path);
      if (!file || wanted.has(path)) continue;
      wanted.add(path);
      const entry = this.#memory.get(path);
      if (entry && !isStale(entry.stamp, file.stat)) {
        this.#memory.delete(path);
        this.#memory.set(path, entry);
        continue;
      }
      if (!isStale(this.#failed.get(path), file.stat)) continue;
      queued.push(path);
    }
    if (wanted.size) this.#wanted.set(consumer, wanted);
    else this.#wanted.delete(consumer);
    this.#queue.want(queued, consumer);
  }

  onReady(callback: (path: string) => void): () => void {
    this.#ready.add(callback);
    return () => this.#ready.delete(callback);
  }

  /** Queue task: read the file start, clean it, store it in memory and announce it. */
  async #load(path: string): Promise<void> {
    const file = this.#host.file(path);
    if (!file) return;
    const entry = this.#memory.get(path);
    if (entry && !isStale(entry.stamp, file.stat)) return;
    const stamp: Stamp = { mtime: file.stat.mtime, size: file.stat.size };
    let text: string;
    try {
      const head = await this.#host.read(path, EXCERPT_HEAD);
      text = excerptOf(head, file.extension);
      if (text === '' && head.length >= EXCERPT_HEAD && file.stat.size > head.length)
        text = excerptOf(await this.#host.read(path, EXCERPT_MORE), file.extension);
    } catch {
      this.#failed.set(path, stamp);
      return;
    }
    if (!this.#host.file(path)) return;
    const old = this.#memory.get(path);
    this.#memory.delete(path);
    this.#memory.set(path, { stamp, text });
    this.#failed.delete(path);
    this.#trim();
    if (old?.text !== text) this.#announce(path);
  }

  /**
   * Announces in a batch on the next frame: however many texts arrive in a frame, listeners run within one
   * frame.
   */
  #announce(path: string): void {
    this.#arrived.add(path);
    if (this.#framed) return;
    this.#framed = true;
    this.#host.frame(() => {
      this.#framed = false;
      const batch = [...this.#arrived];
      this.#arrived.clear();
      for (const one of batch) {
        for (const listener of this.#ready) {
          try {
            listener(one);
          } catch (error) {
            console.error('Buba: first lines listener failed', error);
          }
        }
      }
    });
  }

  /** Over the limit, evicts the oldest entries no consumer currently asks for. */
  #trim(): void {
    const wanted = [...this.#wanted.values()];
    for (const path of this.#memory.keys()) {
      if (this.#memory.size <= this.#memoryLimit) return;
      if (wanted.some((paths) => paths.has(path))) continue;
      this.#memory.delete(path);
    }
  }
}

const stores = new WeakMap<Plugin, Excerpts>();

/** The window's `fetch`, used to read the file start, as for PSD. */
const fetchFile: Fetcher = (src, init) => window.fetch(src, init);

/**
 * The first lines store, one per plugin instance. Desktop: 2 concurrent reads and 2000 texts; phone: 1 and
 * 500. On iPhone, if the file URL ignores `Range` (probed with `manifest.json`, as for PSD in `store.ts`),
 * only files up to 64 MB are read (`phoneReadsHead`).
 */
export function excerptStore(plugin: Plugin): ExcerptStore {
  const known = stores.get(plugin);
  if (known) return known;
  const { vault } = plugin.app;
  let ranged: Promise<boolean> | null = null;
  const probe = async (): Promise<boolean> => {
    const dir = plugin.manifest.dir ?? `${vault.configDir}/plugins/${plugin.manifest.id}`;
    try {
      return (await readHead(fetchFile, vault.adapter.getResourcePath(`${dir}/manifest.json`), 1, 1)).ranged;
    } catch {
      return false;
    }
  };
  const fileOf = (path: string) => {
    const file = vault.getFileByPath(path);
    return file && excerptable(file.extension) ? file : null;
  };
  const store = new Excerpts(
    {
      file: fileOf,
      read: async (path, limit) => {
        const file = fileOf(path);
        if (!file) throw new Error('no file');
        try {
          if (Platform.isIosApp && !phoneReadsHead(file.stat.size, await (ranged ??= probe())))
            throw new Error('file URL on iPhone ignores Range — a file over 64 MB is not read');
          return (await readHead(fetchFile, vault.getResourcePath(file), limit, file.stat.size)).bytes;
        } catch (error) {
          // A file URL may not answer (measured: every note, Obsidian 1.14.4 on Linux without a sandbox): the vault
          // reads the note the way Obsidian does.
          if (file.stat.size > EXCERPT_VAULT_MAX || typeof vault.cachedRead !== 'function') throw error;
          return new TextEncoder().encode(await vault.cachedRead(file)).subarray(0, limit);
        }
      },
      frame: (run) => void window.requestAnimationFrame(run),
    },
    Platform.isMobile ? { reads: 1, memory: PHONE_EXCERPT_MEMORY } : {},
  );
  // No cleanup on unload: only the plugin holds the store (`stores` is a weak map), grids unsubscribe in
  // their own `destroy`, and reads that finish after unload announce to no one.
  stores.set(plugin, store);
  return store;
}
