// "By type" sort: files of one format family (src/core/format/family.ts) stay together, like
// "Type" in Windows Explorer and Finder. Family order: application files → video → images →
// audio → documents → other; inside a group, a chosen list of applications first in a fixed
// order, then the rest in family-table order; for images, regular ones first, then RAW. Only
// this order is ours: Obsidian has no type order table. No `obsidian` import.
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

/**
 * Compares by type, ascending; files of one family (JPG and PNG are both images) are equal, so the second
 * sort level and then the name decide their order.
 */
export function compareByType(a: { readonly ext: string }, b: { readonly ext: string }): number {
  return typeRank(a.ext) - typeRank(b.ext);
}
