// Video and audio duration for the file panel, from metadata without reading the whole file: a hidden
// `<video>` with `preload = 'metadata'`, like Obsidian's own player (app.js 1.14.4). Waits like Obsidian's
// audio embed: for `loadedmetadata`, `error` or 5 s of silence. A `<video>` element is used for audio too:
// Chromium reads mp3 through it just as through `<audio>`. The URL comes from `vault.getResourcePath`, as for
// previews (src/platform/previews/store.ts); the element is muted, never shown, and releases the file once it
// answers. Measured in Obsidian 1.14.4 on Windows: a 186 MB H.264 .mp4 with metadata at the end gave 60 s in
// 6 ms, reading 1.1 MB in two requests (start and tail of the file).

/** How long to wait for metadata, as Obsidian's audio embed does. */
export const WAIT_MS = 5000;

/**
 * Duration in seconds of the media at `src`; `null` on error, `WAIT_MS` of silence, abort, or an infinite or
 * zero duration. The URL is removed from the element at the end, on abort too.
 */
export function mediaDuration(
  src: string,
  signal: AbortSignal,
  make: () => HTMLVideoElement = () => document.createElement('video'),
): Promise<number | null> {
  if (signal.aborted) return Promise.resolve(null);
  const media = make();
  media.muted = true;
  media.playsInline = true;
  media.preload = 'metadata';
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), WAIT_MS);
    const onMeta = () =>
      finish(Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null);
    const onError = () => finish(null);
    const onAbort = () => finish(null);
    function finish(seconds: number | null): void {
      clearTimeout(timer);
      media.removeEventListener('loadedmetadata', onMeta);
      media.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      media.removeAttribute('src');
      media.load();
      resolve(seconds);
    }
    media.addEventListener('loadedmetadata', onMeta);
    media.addEventListener('error', onError);
    signal.addEventListener('abort', onAbort);
    media.src = src;
  });
}
