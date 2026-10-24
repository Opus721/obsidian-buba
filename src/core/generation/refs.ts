// References of a generation as the panel shows them: order, tag and role badge. Lead roles (first and last
// frame, source, mask) come first and carry only a badge; the rest are numbered inside their media type in
// the agent's order — Image1, Image2, Video1, Audio1 — the way a prompt tags them (`@Image1`). A role names
// the type when it is one (`image`, `video`, `audio`); any other role follows the file type. No `obsidian`
// import.
import { formatFamily } from '../format/family.ts';
import type { Passport, PassportRef } from '../storage/passport.ts';
import type { Fingerprint } from '../storage/types.ts';

export type RefMedia = 'image' | 'video' | 'audio' | 'file';

/** Roles shown before the numbered references, in this order. */
export const LEAD_ROLES: readonly string[] = ['first-frame', 'last-frame', 'source', 'mask'];

/** Tag prefix of a numbered reference by media type. */
const TAG: Record<RefMedia, string> = { image: 'Image', video: 'Video', audio: 'Audio', file: 'File' };

/** One reference in panel order. */
export interface RefSlot {
  ref: PassportRef;
  /** Position in the passport's `refs`. */
  index: number;
  media: RefMedia;
  /** `Image2` for a numbered reference, `''` for a lead role. */
  tag: string;
  /** Role shown as a badge: every role except `image`, `video`, `audio` and `file`. */
  badge: string | null;
}

/** Media type of a file by its extension: photos and camera raw are images. */
export function mediaOfPath(path: string): RefMedia {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const id = formatFamily(dot > 0 ? name.slice(dot + 1) : '').family;
  if (id === 'image' || id === 'raw') return 'image';
  if (id === 'video' || id === 'audio') return id;
  return 'file';
}

const PLAIN_ROLES = new Set(['image', 'video', 'audio', 'file']);

function mediaOf(ref: PassportRef): RefMedia {
  if (ref.role === 'image' || ref.role === 'video' || ref.role === 'audio') return ref.role;
  return mediaOfPath(ref.path);
}

/** References in panel order with their tags. */
export function refSlots(passport: Passport): RefSlot[] {
  const refs = passport.refs ?? [];
  const slots = refs.map((ref, index): RefSlot => ({
    ref,
    index,
    media: mediaOf(ref),
    tag: '',
    badge: PLAIN_ROLES.has(ref.role) ? null : ref.role,
  }));
  const lead = LEAD_ROLES.flatMap((role) => slots.filter((slot) => slot.ref.role === role));
  const counts: Record<RefMedia, number> = { image: 0, video: 0, audio: 0, file: 0 };
  const rest = (['image', 'video', 'audio', 'file'] as const).flatMap((media) =>
    slots
      .filter((slot) => slot.media === media && !LEAD_ROLES.includes(slot.ref.role))
      .map((slot) => ({ ...slot, tag: `${TAG[media]}${++counts[media]}` })),
  );
  return [...lead, ...rest];
}

/** A file the panel can look up a missing reference in: path, name and size. */
export interface VaultFileInfo {
  path: string;
  name: string;
  size: number;
}

/**
 * A reference moved while Buba was not looking: the only file with the fingerprint's name and size (the
 * change time differs between devices). None or several give `null`.
 */
export function findMoved(fp: Fingerprint | undefined, files: Iterable<VaultFileInfo>): string | null {
  if (!fp) return null;
  let found: string | null = null;
  for (const file of files) {
    if (file.name !== fp.name || file.size !== fp.size) continue;
    if (found !== null) return null;
    found = file.path;
  }
  return found;
}
