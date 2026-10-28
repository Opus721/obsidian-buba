// "By type" sort: files of one format family (src/core/format/family.ts) stay together, like
// "Type" in Windows Explorer and Finder. Family order: application files → video → images →
// audio → documents → other; inside a group, a chosen list of applications first in a fixed
// order, then the rest in family-table order; for images, regular ones first, then RAW. Inside a family
// files go by extension, as "Type" in Explorer keeps MD and TXT apart. Only this order is ours: Obsidian
// has no type order table. No `obsidian` import.
import { formatFamily, type FormatFamilyId } from '../format/family.ts';

/** Families in "by type" order, ascending: every `FormatFamilyId` exactly once. */
export const TYPE_ORDER: readonly FormatFamilyId[] = [
  // Application files.
  'premiere',
  'motion',
  'photoshop',
  'illustrator',
  'figma',
  'blender',
  'indesign',
  'sketch',
  'edit',
  'c4d',
  'autodesk',
  '3d',
  'daw',
  'flstudio',
  'protools',
  'cubase',
  // Video, images, audio.
  'video',
  'image',
  'raw',
  'audio',
  // Documents.
  'pdf',
  'word',
  'excel',
  'powerpoint',
  'text',
  'canvas',
  'base',
  // Other.
  'archive',
  'font',
  'key',
  'service',
  'other',
];

const RANK = new Map<FormatFamilyId, number>(TYPE_ORDER.map((family, i) => [family, i]));

/** Position of the family of a file with extension `ext` in "by type" order: lower comes first. */
export function typeRank(ext: string): number {
  return RANK.get(formatFamily(ext).family) ?? TYPE_ORDER.length;
}

/** Spellings of one format, so JPEG files stay with JPG ones. */
const SAME_EXT: Readonly<Record<string, string>> = { jpeg: 'jpg', tif: 'tiff', htm: 'html', yml: 'yaml' };

const extKey = (ext: string): string => {
  const lower = ext.toLowerCase();
  return SAME_EXT[lower] ?? lower;
};

/**
 * Compares by type, ascending: by family, then by extension inside it (MD before TXT); files with one
 * extension are equal, so the second sort level and then the name decide their order.
 */
export function compareByType(a: { readonly ext: string }, b: { readonly ext: string }): number {
  const byFamily = typeRank(a.ext) - typeRank(b.ext);
  if (byFamily !== 0) return byFamily;
  const left = extKey(a.ext);
  const right = extKey(b.ext);
  return left < right ? -1 : left > right ? 1 : 0;
}
