// Tag groups use Obsidian's nested tag syntax "group/tag" (https://obsidian.md/help/tags#Nested+tags): a
// tag's group is the part of the name before the last `/`, the short name is after it. Membership needs no
// separate records: "status/done" is in group "status" as long as it is named so. Both parts go through
// `normalizeTag`; an empty part means no group ("/done", "status/"). Groups compare by `tagKey`,
// case-insensitive like tags. No `obsidian` import, checked by `node --test`.
import { normalizeTag, tagKey } from '../storage/types.ts';

/**
 * Tag name to group and short name; without a group, `null` and the whole name. An empty tag gives `null`.
 */
function split(tag: string): { group: string | null; name: string } | null {
  const whole = normalizeTag(tag);
  if (whole === null) return null;
  const cut = whole.lastIndexOf('/');
  const group = cut < 0 ? null : normalizeTag(whole.slice(0, cut));
  const name = cut < 0 ? null : normalizeTag(whole.slice(cut + 1));
  return group !== null && name !== null ? { group, name } : { group: null, name: whole };
}

/** The tag's group in the tag's spelling: "Status/in progress" → "Status"; `null` without a group. */
export function tagGroup(tag: string): string | null {
  return split(tag)?.group ?? null;
}

/** Group key of a tag: `tagKey` of its group; `null` without a group. A nested "a/b/c" is in group "a/b". */
export function groupKey(tag: string): string | null {
  const group = tagGroup(tag);
  return group === null ? null : tagKey(group);
}

/** Tag name without the group: "status/done" → "done"; the whole name without a group. */
export function shortName(tag: string): string {
  return split(tag)?.name ?? '';
}

/**
 * Name of tag `tag` in group `group`: "done" in "status" → "status/done"; an empty or `null` group gives a
 * tag without a group. `renameTag` uses this name to move a tag into and out of a group.
 */
export function groupedName(tag: string, group: string | null): string {
  const name = shortName(tag);
  const into = group === null ? null : normalizeTag(group);
  return into === null ? name : `${into}/${name}`;
}
