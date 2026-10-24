// System file picker, opened the way Obsidian's "Insert attachment" (`editor:attach-file`, app.js 1.13.7 and
// 1.14.4) does it: a hidden `<input type="file">` in the window's document, with `focus()` and `click()`
// called synchronously in a tap or click handler, since neither WebKit nor Chromium opens the picker without
// a user gesture. Obsidian uses this on desktop and phone alike; it has no Electron dialog for it. Our
// differences: `multiple`, and the input lives until `change` or `cancel` rather than 5 s after focus
// returns, because an iOS Photos video takes longer to prepare.
import { Platform } from 'obsidian';

/**
 * "Photos and videos" on iPhone: photos from the library arrive as JPEG. For an input limited to these image
 * types without HEIC, iOS converts to JPEG itself (WebKit bug 267277); videos arrive as iOS gives them (HEVC
 * .MOV).
 */
export const PHOTOS_AND_VIDEOS = 'image/jpeg,image/png,image/gif,image/webp,video/*';

/**
 * Fallback cleanup of the input, in ms: only after focus returns, with a margin, because iOS fires `change`
 * for a long video later than it returns focus. Normally `change` or `cancel` removes the input; the timer
 * covers WebKit without `cancel` (iOS before 16.4).
 */
export const LEFTOVER_MS = 10 * 60_000;

type Activation = { userActivation?: { isActive: boolean } };

/**
 * Opens the picker in window `win`: `accept` lists file types (`null` for any), the chosen files go to
 * `onFiles`, cancel does nothing. Call synchronously in a tap or click handler. On desktop, Chromium silently
 * refuses without live user activation, as with a native menu item (`nativeMenus`: the handler is called by
 * `electron.remote`, not a click): then no input is created and the answer is `false`, so the refusal is
 * visible.
 */
export function pickFiles(win: Window, accept: string | null, onFiles: (files: File[]) => void): boolean {
  const activation = (win.navigator as Navigator & Activation).userActivation;
  if (Platform.isDesktopApp && activation?.isActive === false) return false;
  const doc = win.document;
  const input = doc.body.createEl('input', { type: 'file' });
  input.multiple = true;
  if (accept !== null) input.accept = accept;
  input.setCssStyles({ position: 'fixed', opacity: '0', zIndex: '-9999' });
  let timer = 0;
  let done = false;
  const back = (): void => {
    unwatch();
    win.clearTimeout(timer);
    timer = win.setTimeout(remove, LEFTOVER_MS);
  };
  const unwatch = (): void => {
    win.removeEventListener('focus', back);
    doc.removeEventListener('click', back);
  };
  const remove = (): void => {
    done = true;
    unwatch();
    win.clearTimeout(timer);
    input.detach();
  };
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    remove();
    if (files.length) onFiles(files);
  });
  input.addEventListener('cancel', remove);
  input.focus();
  input.click();
  // Watch focus return and the next click from the next task: the click that opened the picker does not
  // count.
  win.setTimeout(() => {
    if (done) return;
    win.addEventListener('focus', back);
    doc.addEventListener('click', back);
  }, 0);
  return true;
}
