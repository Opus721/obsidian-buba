// Grid sources of the tags block: "tag" is the files of one tag, "group" the files with any tag of a group,
// "untagged" the files without any tag, like "Untagged" in Eagle. Storage queries select the files and also
// handle tag case. No `obsidian` import, checked by `node --test`.
import { tagKey, type BubaStorage, type TagQueries } from '../storage/types.ts';
import { t } from '../i18n/dict/tags.ts';
import { groupKey } from './groups.ts';

/** Files of one tag. */
export type TagSource = { readonly kind: 'tag'; readonly tag: string };

/** Files with any tag of a group. */
export type TagGroupSource = { readonly kind: 'tag-group'; readonly group: string };

/** Files without any tag. */
export type UntaggedSource = { readonly kind: 'untagged' };

/**
 * Files with the tag that exist in the vault: storage keeps records of vanished files (bring the file back
 * and its tags return), but those do not go to the grid. No storage gives none.
 */
export function tagSourcePaths(
  tag: string,
  storage: Pick<BubaStorage, 'filesWithTag'> | undefined,
  exists: (path: string) => boolean,
): string[] {
  return storage ? storage.filesWithTag(tag).filter(exists) : [];
}

/** The vault paths that have no tags. No storage gives none. */
export function untaggedSourcePaths(
  allPaths: string[],
  storage: Pick<BubaStorage, 'untagged'> | undefined,
): string[] {
  return storage ? storage.untagged(allPaths) : [];
}

/**
 * Vault files `paths` with any visible tag of the group, in one pass over them rather than `filesWithTag` per
 * tag of the group (each such call would scan all records). The group is computed once per spelling, not per
 * occurrence: name parsing uses regexes, and at 50k files it tripled a pass the grid repeats on every storage
 * change. If storage selects group files itself (`groupFiles`), those are used, keeping only existing ones: a
 * key lookup over index records without a per-path record, like `filesWithTag` for a tag; `exists` checks the
 * same `paths` if the caller already has such a check. No storage or an empty name gives none.
 */
export function groupSourcePaths(
  group: string,
  storage: (Pick<BubaStorage, 'get'> & Partial<Pick<TagQueries, 'groupFiles'>>) | undefined,
  paths: readonly string[],
  exists?: (path: string) => boolean,
): string[] {
  const key = tagKey(group);
  if (!storage || key === null) return [];
  if (storage.groupFiles) {
    let has = exists;
    if (!has) {
      const set = new Set(paths);
      has = (path) => set.has(path);
    }
    return storage.groupFiles(group).filter(has);
  }
  const known = new Map<string, boolean>();
  const inGroup = (tag: string): boolean => {
    let hit = known.get(tag);
    if (hit === undefined) known.set(tag, (hit = groupKey(tag) === key));
    return hit;
  };
  return paths.filter((path) => storage.get(path).tags.some(inGroup));
}

/** Title for the path above the grid. */
export function sourceTitle(source: TagSource | TagGroupSource | UntaggedSource): string {
  if (source.kind === 'tag') return t('sourceTag', { tag: source.tag });
  return source.kind === 'tag-group' ? t('sourceGroup', { group: source.group }) : t('untagged');
}
