// Where a file opens: Obsidian's own views take notes, canvases, bases, PDFs and audio, by Obsidian's lists
// (src/core/format/obsidian-types.ts); the viewer shows images and video; everything else has no view and
// goes to the system's default app, except programs, scripts and shortcuts (executable.ts). The viewer, a
// double click on a tile and the menu of several tiles decide by these two. No Obsidian and no DOM.
import { AUDIO_EXTS, IMAGE_EXTS, OWN_VIEW_EXTS, VIDEO_EXTS } from '../format/obsidian-types.ts';
import { mayRunAsProgram } from './executable.ts';

/** What Obsidian opens in its own views and the viewer does not show; `webm` is video, as in the viewer. */
const IN_OBSIDIAN: ReadonlySet<string> = new Set([...OWN_VIEW_EXTS, ...AUDIO_EXTS]);

/** Whether Obsidian, not the viewer, opens a file with `extension`. */
export function opensInObsidian(extension: string): boolean {
  return IN_OBSIDIAN.has(extension.toLowerCase());
}

/**
 * Whether "Open in new tab" and the middle button open a file with `extension` in a tab of Obsidian's own:
 * its views and video. Not a picture: Obsidian's image view does not zoom, so the middle button opens it in
 * the viewer, as a double click (word of the owner 28.10 18:10).
 */
export function opensInTab(extension: string): boolean {
  const ext = extension.toLowerCase();
  return IN_OBSIDIAN.has(ext) || VIDEO_EXTS.has(ext);
}

/** Whether a file with `extension` is a picture, which the middle button opens in the viewer. */
export function isPicture(extension: string): boolean {
  return IMAGE_EXTS.has(extension.toLowerCase());
}

/**
 * Whether file `name` with `extension` has no own view in Obsidian or the viewer and is not a program: the
 * public `openFile` hands it to the default app.
 */
export function opensInDefaultApp(extension: string, name: string): boolean {
  const ext = extension.toLowerCase();
  return !IN_OBSIDIAN.has(ext) && !IMAGE_EXTS.has(ext) && !VIDEO_EXTS.has(ext) && !mayRunAsProgram(name);
}
