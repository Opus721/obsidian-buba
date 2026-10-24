// Video frame for previews, without obsidian or canvas: where to seek, when a frame at that point can be
// drawn, and whether it is black. `store.ts` supplies the video and pixels; the test supplies fakes.

/** What seeking needs from a video, which is all the test fakes; `HTMLVideoElement` fits as is. */
export interface FrameVideo {
  currentTime: number;
  readonly readyState: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  requestVideoFrameCallback?(
    callback: (now: number, metadata: { readonly mediaTime: number }) => void,
  ): number;
  cancelVideoFrameCallback?(handle: number): void;
}

/**
 * `HTMLMediaElement.HAVE_CURRENT_DATA`: the current frame's data is there and can be drawn (not defined in
 * node).
 */
const HAVE_CURRENT_DATA = 2;
/** Events with which `readyState` reaches frame data or higher. */
const DATA = ['loadeddata', 'canplay', 'canplaythrough'];

/**
 * How long to wait after `seeked` with frame data for the frame to be presented, if presentation stays
 * silent: when the window is hidden or the video is not on the page, frame callbacks follow page rendering,
 * and before November 2024 WebKit did not call them for an unrendered frame (WebKit bug 282797). Kept short
 * so a silent presentation does not cost every video `WAIT_MS`.
 */
export const FRAME_MS = 500;

/**
 * Longest frame that a presentation before `seeked` may count as the target frame: 0.5 s, i.e. 2 fps. A
 * presented frame's time (`mediaTime`) is its start, and the target frame starts less than one frame duration
 * before the target; a frame 0.5 s or more earlier is something else, e.g. an intermediate frame of a long
 * seek.
 */
const LONGEST_FRAME_S = 0.5;

/**
 * Channels no brighter than this (of 255) count as black. Black in limited-range BT.601/709 video is code 16:
 * it and everything below map to RGB 0, and codec noise on black is a few units; an undrawn canvas is
 * transparent black, RGB
 * 0. A frame with no pixel above the threshold looks black on a tile anyway, while a dark scene with any
 * brighter detail is a fine preview.
 */
export const BLACK_LEVEL = 10;

/**
 * Preview frame points in order: at a third of the length but no later than 1 s; if that is black (a
 * fade-in), the middle. An unknown length counts as three seconds.
 */
export function frameTimes(duration: number): number[] {
  const length = Number.isFinite(duration) ? duration : 3;
  return [Math.min(1, length / 3), length / 2];
}

/** Whether a frame is black: no color channel of any RGBA pixel is brighter than `BLACK_LEVEL`. */
export function isBlackFrame(rgba: ArrayLike<number>, level = BLACK_LEVEL): boolean {
  for (let at = 0; at + 2 < rgba.length; at += 4) {
    if ((rgba[at] ?? 0) > level || (rgba[at + 1] ?? 0) > level || (rgba[at + 2] ?? 0) > level) return false;
  }
  return true;
}

/**
 * Seeks the video to `time` and waits until the frame there can be drawn. WebKit fires `seeked` before the
 * frame is decoded, and `drawImage` then draws black (WebKit bug 236604); the reliable signal is
 * `requestVideoFrameCallback`. WebKit calls it as soon as the frame is presented, sometimes before `seeked`,
 * so the callback is requested before seeking: when paused, no new frame may come after `seeked`. A
 * presentation before `seeked` counts only if the frame time is closer to the target than to the pre-seek
 * position (a frame of the old position, e.g. the first after load, is near that) and less than
 * `LONGEST_FRAME_S` before the target: web video does not report frame rate, and below 24 fps the target
 * frame is more than 1/24 s away. Otherwise the callback is requested again; after `seeked` any presentation
 * is the target frame. Done on presentation plus `seeked`; if presentation is silent, on `seeked`, frame data
 * and at most `FRAME_MS` more; without the API, on the next animation frame. A video error or the whole thing
 * taking longer than `limit` rejects.
 */
export function seekFrame(video: FrameVideo, time: number, limit: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    let seeked = false;
    let shown = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    let paint: number | undefined;
    let request: number | undefined;
    const frames = video.requestVideoFrameCallback !== undefined;
    const from = video.currentTime;
    const atPoint = (shown: number): boolean =>
      Math.abs(shown - time) < Math.abs(shown - from) && time - shown < LONGEST_FRAME_S;
    const timer = setTimeout(() => finish(new Error(`no video frame in ${limit} ms`)), limit);
    const ask = () => {
      request = video.requestVideoFrameCallback?.((_now, metadata) => {
        request = undefined;
        if (done) return;
        if (!seeked && !atPoint(metadata.mediaTime)) return ask();
        shown = true;
        check();
      });
    };
    ask();
    const onSeeked = () => {
      seeked = true;
      check();
    };
    const onError = () => finish(new Error('video error while seeking'));
    function check(): void {
      if (done || !seeked) return;
      if (shown) return finish();
      if (grace !== undefined || video.readyState < HAVE_CURRENT_DATA) return;
      grace = setTimeout(() => finish(), FRAME_MS);
      if (!frames) paint = requestAnimationFrame(() => finish());
    }
    function finish(error?: Error): void {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(grace);
      if (request !== undefined) video.cancelVideoFrameCallback?.(request);
      if (paint !== undefined) cancelAnimationFrame(paint);
      video.removeEventListener('seeked', onSeeked);
      for (const type of DATA) video.removeEventListener(type, check);
      video.removeEventListener('error', onError);
      if (error) reject(error);
      else resolve();
    }
    video.addEventListener('seeked', onSeeked);
    for (const type of DATA) video.addEventListener(type, check);
    video.addEventListener('error', onError);
    video.currentTime = time;
  });
}
