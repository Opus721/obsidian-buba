// What "Install font" knows about a font file before it reaches the system, without `obsidian`: which
// extensions Windows Explorer offers "Install" for, whether the bytes really are a font (the sfnt signature),
// the font's full name from its `name` table and the name Windows keeps it under in the registry,
// "Russo One (TrueType)", the way Explorer writes it. The name is text from the file, so control characters
// are dropped and its length is capped before it goes anywhere.
// Format: https://learn.microsoft.com/typography/opentype/spec/otff and …/spec/name
import { t } from '../i18n/dict/actions.ts';

/** Extensions with "Install" in Windows Explorer that Buba installs: TrueType, OpenType, collections. */
export const FONT_EXTENSIONS: readonly string[] = ['ttf', 'otf', 'ttc'];

/** Largest font file read for install: big CJK fonts are 20–40 MB. */
export const FONT_MAX_BYTES = 100 * 1024 * 1024;

/** Longest registry name kept; Windows allows 16 383 characters, real names are under 100. */
const NAME_MAX = 200;

export function isFontExtension(extension: string): boolean {
  return FONT_EXTENSIONS.includes(extension.toLowerCase());
}

/** A font ready to install: its full name and its registry name. */
export interface FontPlan {
  /** Full name from the file, or the file name without extension when the file has none. */
  readonly name: string;
  /** Registry value name: "<name> (TrueType)", or "(OpenType)" for PostScript outlines (`OTTO`). */
  readonly registryName: string;
}

/**
 * The plan for one font file, or `null` when the bytes are not a TrueType, OpenType or collection font
 * (renamed `.ttf` of something else, an empty or cut file).
 */
export function fontPlan(fileName: string, bytes: Uint8Array): FontPlan | null {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let start = 0;
  if (tag(data, 0) === 'ttcf') {
    // A collection: the first font's table directory names it, as in Explorer's list.
    if (bytes.byteLength < 16 || data.getUint32(8) === 0) return null;
    start = data.getUint32(12);
  }
  const flavor = signature(data, start);
  if (flavor === null) return null;
  const name = cleanName(fullName(data, start)) || cleanName(baseName(fileName)) || 'Font';
  const kind = flavor === 'cff' ? 'OpenType' : 'TrueType';
  return { name, registryName: `${name} (${kind})` };
}

/** `truetype` for glyph outlines, `cff` for PostScript ones, `null` for anything else. */
function signature(data: DataView, at: number): 'truetype' | 'cff' | null {
  if (at + 12 > data.byteLength) return null;
  const version = data.getUint32(at);
  if (version === 0x00010000 || tag(data, at) === 'true') return 'truetype';
  if (tag(data, at) === 'OTTO') return 'cff';
  return null;
}

function tag(data: DataView, at: number): string {
  if (at + 4 > data.byteLength) return '';
  return String.fromCharCode(
    data.getUint8(at),
    data.getUint8(at + 1),
    data.getUint8(at + 2),
    data.getUint8(at + 3),
  );
}

/** Name ids of the `name` table: family, subfamily, full name. */
const FAMILY = 1;
const SUBFAMILY = 2;
const FULL = 4;

/**
 * The full name (id 4) in English from the `name` table; without one, family and subfamily ("Regular"
 * left out). Empty when the table is missing or broken.
 */
function fullName(data: DataView, start: number): string {
  const table = nameTable(data, start);
  if (!table) return '';
  const full = pick(table, FULL);
  if (full) return full;
  const family = pick(table, FAMILY);
  const sub = pick(table, SUBFAMILY);
  return family && sub && sub.toLowerCase() !== 'regular' ? `${family} ${sub}` : family;
}

interface NameRecord {
  platform: number;
  encoding: number;
  language: number;
  id: number;
  text: string;
}

function nameTable(data: DataView, start: number): NameRecord[] | null {
  const count = data.getUint16(start + 4);
  for (let i = 0; i < count; i++) {
    const at = start + 12 + i * 16;
    if (at + 16 > data.byteLength) return null;
    if (tag(data, at) !== 'name') continue;
    const offset = data.getUint32(at + 8);
    if (offset + 6 > data.byteLength) return null;
    const records = data.getUint16(offset + 2);
    const strings = offset + data.getUint16(offset + 4);
    const list: NameRecord[] = [];
    for (let r = 0; r < records; r++) {
      const rec = offset + 6 + r * 12;
      if (rec + 12 > data.byteLength) break;
      const platform = data.getUint16(rec);
      const encoding = data.getUint16(rec + 2);
      const from = strings + data.getUint16(rec + 10);
      const length = data.getUint16(rec + 8);
      if (from + length > data.byteLength) continue;
      list.push({
        platform,
        encoding,
        language: data.getUint16(rec + 4),
        id: data.getUint16(rec + 6),
        text: decode(data, from, length, platform),
      });
    }
    return list;
  }
  return null;
}

/** Windows and Unicode names are UTF-16BE; Macintosh ones are single-byte, read as Latin-1. */
function decode(data: DataView, from: number, length: number, platform: number): string {
  let text = '';
  if (platform === 0 || platform === 3) {
    for (let i = 0; i + 1 < length; i += 2) text += String.fromCharCode(data.getUint16(from + i));
  } else {
    for (let i = 0; i < length; i++) text += String.fromCharCode(data.getUint8(from + i));
  }
  return text;
}

/** Windows US English first, as Explorer shows it; then any Windows name, Unicode, Macintosh Roman. */
function pick(records: readonly NameRecord[], id: number): string {
  const of = records.filter((each) => each.id === id && each.text.trim());
  const best =
    of.find((each) => each.platform === 3 && each.language === 0x409) ??
    of.find((each) => each.platform === 3) ??
    of.find((each) => each.platform === 0) ??
    of.find((each) => each.platform === 1 && each.encoding === 0);
  return best?.text ?? '';
}

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** Without control characters, single spaces, trimmed, at most `NAME_MAX` characters. */
export function cleanName(text: string): string {
  return text.replace(CONTROL, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** How one font install ended: done, already installed (left as it is), failed, or the file is no font. */
export type FontOutcome = 'installed' | 'exists' | 'failed';
export type FontResult = FontOutcome | 'not-font';

/**
 * The notice after an install: one file is named ("Font "Russo One" installed"), several are counted, one
 * line per outcome; a file that is no font counts as not installed.
 */
export function fontReport(results: readonly FontResult[], firstName: string): string {
  const [only] = results;
  const name = firstName;
  if (results.length === 1 && only) {
    if (only === 'installed') return t('fontInstalled', { name });
    if (only === 'exists') return t('fontExists', { name });
    if (only === 'not-font') return t('notAFont', { name });
    return t('fontFailed', { name });
  }
  const installed = results.filter((each) => each === 'installed').length;
  const exists = results.filter((each) => each === 'exists').length;
  const failed = results.length - installed - exists;
  const lines: string[] = [];
  if (installed) lines.push(t('fontsInstalledCount', { count: installed }));
  if (exists) lines.push(t('fontsExistCount', { count: exists }));
  if (failed) lines.push(t('fontsFailedCount', { count: failed }));
  return lines.join('\n');
}
