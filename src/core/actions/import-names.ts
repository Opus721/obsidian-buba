// Names of new files from the file manager and the clipboard are external input: a name never leads outside
// the folder, never has characters Windows rejects, and never overwrites an existing file.
import { t } from '../i18n/dict/actions.ts';

/** Name length limit, with room for a counter ("name 12.png") below the Windows limit of 255. */
export const MAX_NAME_LENGTH = 200;
/** Characters not allowed in a file name, as the rename and new-folder dialogs list them when refusing. */
export const FORBIDDEN_SHOWN = '/ \\ : * ? " < > |';

/** No-break spaces: Obsidian turns them into plain spaces on write (`normalizePath`). */
const NO_BREAK_SPACE = /\u00a0|\u202f/g;
/** Control characters: C0, DEL and C1. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** Characters Windows rejects in a name (learn.microsoft.com, "Naming Files, Paths, and Namespaces"). */
const FORBIDDEN = /[*"\\/<>:|?]/g;
/** Windows device names, alone or with an extension: NUL.txt and NUL.tar.gz both mean NUL. */
const RESERVED = /^(?:con|prn|aux|nul|(?:com|lpt)[1-9¹²³]) *(?:\.|$)/i;
/**
 * Extension: a dot and up to 15 characters without dots or spaces at the end of the name. A leading dot is
 * not an extension, so a character must precede it. That character is part of the match instead of a
 * lookbehind: iOS below 16.4 cannot parse lookbehind, and then the whole plugin fails to load.
 */
const EXTENSION = /.(\.[^. ]{1,15})$/;
/** What Obsidian 1.13.7 strips from an attachment stem (`getAvailablePathForAttachment`). */
const ATTACHMENT_CUT = /[#^|:]|\[\[|\]\]/g;
/** Pasted image MIME type to extension, as in Obsidian: `image/jpeg` becomes `.jpg`. */
const PASTED_IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

function splitExtension(name: string): [stem: string, extension: string] {
  const extension = EXTENSION.exec(name)?.[1];
  return extension ? [name.slice(0, -extension.length), extension] : [name, ''];
}

const dropTrailing = (name: string) => name.replace(/[. ]+$/, '');
const unreserved = (name: string) => (RESERVED.test(name) ? `_${name}` : name);

/** Caps the length: the stem is cut, the extension kept, a surrogate pair is never split. */
function fitLength(name: string): string {
  if (name.length <= MAX_NAME_LENGTH) return name;
  const [stem, extension] = splitExtension(name);
  let end = MAX_NAME_LENGTH - extension.length;
  if (/[\ud800-\udbff]/.test(stem.charAt(end - 1))) end -= 1;
  return stem.slice(0, end) + extension;
}

/**
 * Safe file name. First normalized the way Obsidian normalizes a path on write (no-break spaces to spaces,
 * NFC); only the last segment after `/` or `\` is kept; control characters are removed; `* " \ / < > : | ?`
 * become `_`; leading dots and trailing dots and spaces are removed; Windows device names get a leading `_`;
 * at most 200 characters; empty becomes `file`. Show the name only as text, never as HTML.
 */
export function safeFileName(raw: string): string {
  // Clean the name as it lands on disk: otherwise `CON\u00a0.png` is written as device name `CON .png`.
  const spaced = raw.replace(NO_BREAK_SPACE, ' ');
  const last = spaced.slice(Math.max(spaced.lastIndexOf('/'), spaced.lastIndexOf('\\')) + 1);
  const clean = last.replace(CONTROL, '').normalize('NFC').replace(FORBIDDEN, '_').replace(/^\.+/, '');
  // Cutting may leave a trailing space or dot, and without them the name may become a device name, so both
  // rules run again after the cut.
  return unreserved(dropTrailing(fitLength(unreserved(dropTrailing(clean))))) || 'file';
}

/**
 * Name to hand Obsidian for an attachment. Obsidian strips `# ^ | :`, `[[`, `]]` and surrounding spaces from
 * the stem (everything before the last dot). If nothing but dots is left, the file would become hidden
 * (`#.png` to `.png`) and `safeFileName` would then drop its extension, so the stem becomes "Untitled" and
 * the extension stays.
 */
export function attachmentName(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot === -1 ? name : name.slice(0, dot);
  const left = stem.replace(ATTACHMENT_CUT, ' ').replace(/[\s.]/g, '');
  // The stem Obsidian 1.13.7 gives a new file without a name (`createNewFile`): "Untitled", translated.
  return left ? name : `${t('untitled')}${dot === -1 ? '' : name.slice(dot)}`;
}

/**
 * Pasted image name as in Obsidian: "Pasted image YYYYMMDDHHmmss.png" in local time. Returns `null` for
 * anything but PNG, JPEG, WebP or GIF: only images are pasted from the clipboard.
 */
export function pastedImageName(date: Date, mime: string): string | null {
  const extension = PASTED_IMAGE_TYPES.get(mime.trim().toLowerCase());
  if (!extension) return null;
  const two = (value: number) => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}`;
  const time = `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
  return `Pasted image ${day}${time}.${extension}`;
}

/**
 * Free path in a folder, like Obsidian's `Vault.getAvailablePath`: `name.ext`, then `name 1.ext`,
 * `name 2.ext`. The folder is a path from the vault root, the root is `'/'`. `exists` decides
 * whether a path is taken.
 */
export function availablePath(folder: string, name: string, exists: (path: string) => boolean): string {
  const dir = folder.replace(/\/+$/, '');
  const inFolder = (file: string) => (dir ? `${dir}/${file}` : file);
  const [stem, extension] = splitExtension(name);
  let path = inFolder(name);
  for (let n = 1; exists(path); n += 1) path = inFolder(`${stem} ${n}${extension}`);
  return path;
}
