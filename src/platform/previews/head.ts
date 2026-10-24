// File start for the embedded PSD and AI thumbnail: fetched from the file URL (`vault.getResourcePath`) with
// a `Range` hint, as a stream cancelled as soon as the limit is read, so the whole file is never read even if
// the URL ignores `Range` (on desktop the `app://` handler returns exactly the slice, on iPhone with old
// Capacitor the file from the start). Every request starts at byte 0: old Capacitor would return a middle
// `Range` from the start too, and the parser could not tell the offset. No `obsidian` import; `fetch` is
// passed in.
import type { Embedded, Scanner } from '../../core/format/thumbnail.ts';

/**
 * First chunk: real PSD and AI files have the thumbnail in it (byte ~19,000 for Photoshop, ~2,000 for
 * Illustrator).
 */
export const HEAD_FIRST = 64 * 1024;
/**
 * Never read past this: if the parser asks for more there is no thumbnail and the tile keeps its format
 * badge. The edge case is a PSD with over 16 MB of XMP before the thumbnail (thousands of
 * `photoshop:DocumentAncestors`): the file has a thumbnail but the tile shows the badge.
 */
export const HEAD_MAX = 16 * 1024 * 1024;
/** Max requests per file: each is at least twice as long as the last, so 64 KB to 16 MB takes nine. */
const MAX_REQUESTS = 10;

/** `fetch`, or a fake in tests. */
export type Fetcher = (src: string, init: RequestInit) => Promise<Response>;

/** The file start that was read; `ranged` means the URL honored `Range` (status 206). */
export interface Head {
  readonly bytes: Uint8Array;
  readonly ranged: boolean;
}

/**
 * First `min(limit, size)` bytes of the file at `src` via `Range: bytes=0-<min(limit, size) − 1>`; the end
 * must not pass the last byte, or Obsidian's fallback `app://` handler answers 416. A 0-byte file makes no
 * request. A non-2xx answer or no body throws: that is a read failure, not "no thumbnail".
 */
export async function readHead(fetcher: Fetcher, src: string, limit: number, size: number): Promise<Head> {
  const want = Math.floor(Math.min(limit, size));
  if (!(want > 0)) return { bytes: new Uint8Array(0), ranged: false };
  const response = await fetcher(src, { headers: { Range: `bytes=0-${want - 1}` }, cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error(`reading file start: ${response.status}`);
  const reader = response.body.getReader();
  const bytes = new Uint8Array(want);
  let got = 0;
  try {
    while (got < want) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const take = Math.min(chunk.value.length, want - got);
      bytes.set(chunk.value.subarray(0, take), got);
      got += take;
    }
  } finally {
    // If the URL ignored Range, the rest of the file is not pulled: the stream is cancelled.
    await reader.cancel().catch(() => undefined);
  }
  return { bytes: bytes.subarray(0, got), ranged: response.status === 206 };
}

/**
 * Thumbnail of a file of `size` bytes at `src`: the first chunk is `HEAD_FIRST`, then up to the byte the
 * parser asked for plus one first chunk, and at least double what was read; beyond `HEAD_MAX` or the file
 * size there is no thumbnail (`null`). A 0-byte file makes no request. A read failure throws.
 */
export async function readThumbnail(
  fetcher: Fetcher,
  src: string,
  size: number,
  scan: Scanner,
): Promise<Embedded | null> {
  if (!(size > 0)) return null;
  const cap = Math.min(size, HEAD_MAX);
  let limit = Math.min(size, HEAD_FIRST);
  for (let request = 0; request < MAX_REQUESTS; request++) {
    const { bytes } = await readHead(fetcher, src, limit, size);
    const result = scan(bytes, size);
    if (result === null) return null;
    if ('found' in result) return result.found;
    // The stream ended before the limit: the file is shorter than Obsidian said, nothing more to read.
    if (bytes.length < limit || !(result.need > bytes.length) || result.need > cap) return null;
    limit = Math.min(cap, Math.max(result.need + HEAD_FIRST, bytes.length * 2));
  }
  return null;
}

/**
 * Slice `[begin, end)` of the file at `src`, for reading a PDF from an offset: `Range: bytes=<begin>-<end −
 * 1>`, body streamed as in `readHead`. If more arrives than requested the stream is cancelled, having read at
 * most the slice plus one stream chunk; more or less than the slice throws, since the URL returned the wrong
 * slice and that is a read failure. So does a non-2xx answer or no body. `signal` cancels the request and the
 * body read.
 */
export async function readRange(
  fetcher: Fetcher,
  src: string,
  begin: number,
  end: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const want = end - begin;
  if (!(want > 0)) return new Uint8Array(0);
  const response = await fetcher(src, {
    headers: { Range: `bytes=${begin}-${end - 1}` },
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok || !response.body) throw new Error(`reading file range: ${response.status}`);
  const reader = response.body.getReader();
  const bytes = new Uint8Array(want);
  let got = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (got + chunk.value.length > want)
        throw new Error(`URL returned more than range ${begin}-${end - 1}`);
      bytes.set(chunk.value, got);
      got += chunk.value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (got !== want)
    throw new Error(`URL returned ${got} bytes instead of ${want}: range ${begin}-${end - 1}`);
  return bytes;
}
