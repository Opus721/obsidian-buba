// Text inserted where Buba tiles are dropped into a note. Core rule, no `obsidian` import. Matches the
// Obsidian 1.13.7 file explorer (the editor drop handler in `app.js`): the link follows the user's settings
// via `FileManager.generateMarkdownLink`, a "!" prefix depends on the file extension, one link per line.
// Receiving the drop and inserting is in src/assets/actions/note-drop.ts.
import { AUDIO_EXTS, IMAGE_EXTS, VIDEO_EXTS } from '../format/obsidian-types.ts';

/**
 * Extensions the Obsidian 1.13.7 file explorer inserts as "!" embeds: Obsidian's image, audio and video types
 * (src/core/format/obsidian-types.ts), PDF, base and canvas; compared case-insensitively.
 */
const EMBEDDED: ReadonlySet<string> = new Set([
  ...IMAGE_EXTS,
  ...AUDIO_EXTS,
  ...VIDEO_EXTS,
  'pdf',
  'base',
  'canvas',
]);

export interface NoteLink {
  /** File extension (`TFile.extension`), without the dot. */
  extension: string;
  /** Host link: `generateMarkdownLink(file, notePath)`. */
  link: string;
}

/** Inserted text: links in tile order joined by `\n`, no trailing newline; an empty list gives `''`. */
export function noteDropText(links: readonly NoteLink[]): string {
  return links
    .map(({ extension, link }) => (EMBEDDED.has(extension.toLowerCase()) ? `!${link}` : link))
    .join('\n');
}
