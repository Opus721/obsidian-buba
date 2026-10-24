// Pure part of the file panel: type, dates, duration, name and its check. No `obsidian` import, so
// `node --test` tests it as is (like the tree model in src/assets/tree). Size is in
// src/core/inspector/size.ts.
import { AUDIO_EXTS, IMAGE_EXTS, VIDEO_EXTS } from '../../core/format/obsidian-types.ts';
import { t } from '../../core/i18n/dict/inspector.ts';

/**
 * "PNG image", "MP4 video", "MP3 audio", otherwise "PSD file"; no extension gives "File". Image, video and
 * audio are the types Obsidian opens itself (src/core/format/obsidian-types.ts).
 */
export function fileType(ext: string): string {
  if (!ext) return t('typeNoExt');
  const key = ext.toLowerCase();
  const kind = IMAGE_EXTS.has(key)
    ? 'typeImage'
    : VIDEO_EXTS.has(key)
      ? 'typeVideo'
      : AUDIO_EXTS.has(key)
        ? 'typeAudio'
        : 'typeFile';
  return t(kind, { ext: ext.toUpperCase() });
}

export type MediaKind = 'video' | 'audio';

/** Video or audio that Obsidian plays in its own player gets a duration in the panel; otherwise `null`. */
export function mediaKind(ext: string): MediaKind | null {
  const key = ext.toLowerCase();
  if (VIDEO_EXTS.has(key)) return 'video';
  if (AUDIO_EXTS.has(key)) return 'audio';
  return null;
}

/**
 * Duration formatted like the time in Obsidian's player (Obsidian 1.14): fractions of a second are dropped,
 * "0:07", "3:05", "10:05", with hours "1:02:03".
 */
export function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

/** Name without extension and extension, split at the last dot; a leading dot does not start an extension. */
export function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot + 1) } : { base: name, ext: '' };
}

/** Characters Obsidian does not allow in a file name. */
export const FORBIDDEN_SIGNS = '* " \\ / < > : | ?';

/** Characters that make Obsidian reject a name on rename: links to such a file would not work. */
export const LINK_UNSAFE_SIGNS = '# ^ [ ] |';

/**
 * What is wrong with the name: the notice text, with checks in the order Obsidian's rename uses; a valid name
 * gives `null`. Obsidian rejects a leading dot: such a file drops out of the vault and links to it break. It
 * also rejects `# ^ [ ]`, checked after the leading dot: links to such a file do not work.
 */
export function nameProblem(base: string): string | null {
  if (/[*"\\/<>:|?]/.test(base)) return t('nameInvalidChars', { signs: FORBIDDEN_SIGNS });
  if (base.trim() === '') return t('nameEmpty');
  if (base.startsWith('.')) return t('nameDot');
  if (/[#^[\]]/.test(base)) return t('nameUnsafeChars', { signs: LINK_UNSAFE_SIGNS });
  return null;
}

/**
 * Whether the user edited the name field: its value differs from what was drawn (edge spaces do not count, as
 * on rename). If the file is renamed elsewhere, an unedited field takes the new name instead of reverting it.
 */
export function nameEdited(shown: string, value: string): boolean {
  return value.trim() !== shown;
}

/** The name is valid: not empty, no leading dot and no characters Obsidian rejects. */
export function validName(base: string): boolean {
  return nameProblem(base) === null;
}

/** "1 file", "2 files", with the plural forms of the interface language. */
export function countFiles(n: number): string {
  return t('fileCount', { count: n });
}
