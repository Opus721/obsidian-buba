// Formats Obsidian opens itself, in one place for the whole product. The lists match `app.js` of Obsidian
// 1.14.4: `kx` (images), `Cx` (audio), `Ex` (video), `Sx`, `xx`, `Tx`, `Mx` (note, canvas, base, PDF); in
// 1.13.7 the same lists are `hb`, `pb`, `db`. `obsidian.d.ts` has no public list. When an Obsidian release
// adds a format, only this file changes, checked against its `app.js` by a test.
// Preview lists (src/platform/previews/plan.ts) and icon lists (src/core/format/family.ts) follow other rules
// and do not come from here. Matching is by lowercase extension.

/** Images Obsidian shows in its own view and embeds. */
export const IMAGE_EXTS: ReadonlySet<string> = new Set([
  'bmp',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'avif',
]);

/** Audio Obsidian plays in its own player and embeds. */
export const AUDIO_EXTS: ReadonlySet<string> = new Set([
  'mp3',
  'wav',
  'm4a',
  '3gp',
  'flac',
  'ogg',
  'oga',
  'opus',
]);

/** Video Obsidian plays in its own player and embeds. */
export const VIDEO_EXTS: ReadonlySet<string> = new Set(['mp4', 'webm', 'ogv', 'mov', 'mkv']);

/** Obsidian's own views besides media: note, canvas, base, PDF. */
export const OWN_VIEW_EXTS: ReadonlySet<string> = new Set(['md', 'canvas', 'base', 'pdf']);
