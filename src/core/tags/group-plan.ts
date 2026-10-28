// Plans for tag group edits from the "All tags" menu and the tags window: what an action
// will do and what to ask before it, such as merging with an existing group or tag, removing
// siblings in an exclusive group, or the name of a new tag. The edits themselves are
// `renameTag`, `renameGroup` and storage writes. The tag list is storage's `allTags()`: tags
// on files and declared ones without files. No `obsidian` import, checked by `node --test`.
import type { PinnedColors } from '../color/palette.ts';
import { t } from '../i18n/dict/tags.ts';
import { normalizeTag, tagKey, type BubaStorage, type TagCount } from '../storage/types.ts';
import { groupKey, groupedName, shortName, tagGroup } from './groups.ts';

const collator = new Intl.Collator('ru', { numeric: true });

/**
 * A tag group of the list: its key, its name as spelled by its alphabetically first tag, and its tag count.
 */
export interface GroupInfo {
  key: string;
  name: string;
  tags: number;
}

/** Tag groups of `all`, alphabetically. */
export function tagGroups(all: readonly TagCount[]): GroupInfo[] {
  const groups = new Map<string, GroupInfo>();
  for (const { tag } of [...all].sort((a, b) => collator.compare(a.tag, b.tag))) {
    const key = groupKey(tag);
    if (key === null) continue;
    const known = groups.get(key);
    if (known) known.tags += 1;
    else groups.set(key, { key, name: tagGroup(tag) ?? key, tags: 1 });
  }
  return [...groups.values()].sort((a, b) => collator.compare(a.name, b.name));
}

/** What "Rename group" will do: rename, merge into an existing group (with `tags` tags) or refuse. */
export type GroupRenamePlan =
  | { kind: 'rename'; to: string }
  | { kind: 'merge'; to: string; tags: number }
  | { kind: 'refuse'; reason: string };

/**
 * The name after `normalizeTag`; empty, with "/" at an edge (such a group gives tags an empty name part) or
 * the same key is refused. The name of an existing group merges in its spelling: tags merge and that group
 * keeps its settings (`renameGroup`).
 */
export function planRenameGroup(from: string, to: string, all: readonly TagCount[]): GroupRenamePlan {
  const name = normalizeTag(to);
  const key = tagKey(to);
  if (name === null || key === null) return { kind: 'refuse', reason: t('emptyName') };
  if (name.startsWith('/') || name.endsWith('/')) return { kind: 'refuse', reason: t('groupNameSlash') };
  if (key === tagKey(from)) return { kind: 'refuse', reason: t('sameGroup') };
  const existing = tagGroups(all).find((group) => group.key === key);
  return existing ? { kind: 'merge', to: existing.name, tags: existing.tags } : { kind: 'rename', to: name };
}

/** What "New tag" will do: declare tag `tag`, or refuse with a reason for the notice. */
export type NewTagPlan = { kind: 'create'; tag: string } | { kind: 'refuse'; reason: string };

/**
 * Name of a new tag after `normalizeTag`. Without a group, a name with "/" creates a tag in a group
 * (Obsidian's nested tag syntax); inside group `group` the user types the short name, the full one is
 * "group/name", and a "/" in it would move the tag to another group. Refused: an empty name, "/" at an edge
 * (an empty name part), "/" in the short name of a group tag, and the name of an existing tag,
 * case-insensitive, with files or declared without them.
 */
export function planNewTag(text: string, group: string | null, all: readonly TagCount[]): NewTagPlan {
  const name = normalizeTag(text);
  if (name === null) return { kind: 'refuse', reason: t('emptyName') };
  if (name.startsWith('/') || name.endsWith('/')) return { kind: 'refuse', reason: t('tagNameSlash') };
  const into = group === null ? null : normalizeTag(group);
  if (into !== null && name.includes('/'))
    return { kind: 'refuse', reason: t('slashInGroupTag', { group: into }) };
  const tag = into === null ? name : `${into}/${name}`;
  const key = tagKey(tag);
  const existing = all.find((item) => tagKey(item.tag) === key);
  return existing
    ? { kind: 'refuse', reason: t('tagExists', { tag: existing.tag }) }
    : { kind: 'create', tag };
}

/** An item of the "Move to group…" window: an existing group with its tag count, or a new typed name. */
export interface GroupChoice {
  name: string;
  tags: number;
  isNew: boolean;
}

/**
 * Groups to move a tag into: existing ones except its own group `current`,
 * prefix matches before infix matches; a typed name that matches no group
 * comes first as "New group". An empty query lists all, alphabetically.
 */
export function groupChoices(
  query: string,
  groups: readonly GroupInfo[],
  current: string | null,
): GroupChoice[] {
  const own = current === null ? null : tagKey(current);
  const others = groups.filter((group) => group.key !== own);
  const key = tagKey(query);
  const existing = ({ name, tags }: GroupInfo): GroupChoice => ({ name, tags, isNew: false });
  if (key === null) return others.map(existing);
  const starts = others.filter((group) => group.key.startsWith(key));
  const inside = others.filter((group) => !group.key.startsWith(key) && group.key.includes(key));
  const name = normalizeTag(query) ?? query;
  const known = groups.some((group) => group.key === key);
  const fresh: GroupChoice[] =
    known || name.startsWith('/') || name.endsWith('/') ? [] : [{ name, tags: 0, isNew: true }];
  return [...fresh, ...starts.map(existing), ...inside.map(existing)];
}

/**
 * Files of tag `tag` that would lose another visible tag of group `group` when the tag moves there, because
 * the group is exclusive and tagging removes siblings. Nothing without a group, without the flag, or for a
 * group with no tags (it is born without the flag). Paths, so the window counts only files that exist.
 */
export function moveConflicts(
  storage: Pick<BubaStorage, 'filesWithTag' | 'get' | 'groupSettings'>,
  tag: string,
  group: string | null,
): string[] {
  const key = group === null ? null : tagKey(group);
  if (key === null || !storage.groupSettings(key).exclusive) return [];
  const target = tagKey(groupedName(tag, group));
  return storage
    .filesWithTag(tag)
    .filter((path) =>
      storage
        .get(path)
        .tags.some(
          (other) => groupKey(other) === key && tagKey(other) !== target && tagKey(other) !== tagKey(tag),
        ),
    );
}

/**
 * Tags of an exclusive group that files would have together after tags move into it: a file shows one of
 * them, and the user picks which (word of the owner 27.10). `tags` are the names after the move, by name;
 * `kept` is the one that would show without a choice, the moved tag written last; `paths` are the files.
 */
export interface MoveChoice {
  tags: string[];
  kept: string;
  paths: string[];
}

/**
 * Choices for moving `moves` (old and new name, in the order they are written) into group `group`: one per
 * set of tags that files would have together, most files first, then by name. Only files that exist count. Nothing without
 * a group or without the flag.
 */
export function moveChoices(
  storage: Pick<BubaStorage, 'filesWithTag' | 'get' | 'groupSettings'>,
  moves: readonly { from: string; to: string }[],
  group: string | null,
  exists: (path: string) => boolean,
): MoveChoice[] {
  const key = group === null ? null : tagKey(group);
  if (key === null || !storage.groupSettings(key).exclusive) return [];
  const renamed = new Map(moves.map(({ from, to }) => [tagKey(from), to]));
  const order = new Map(moves.map(({ to }, at) => [tagKey(to), at]));
  const paths = new Set(moves.flatMap(({ from }) => storage.filesWithTag(from)).filter(exists));
  const choices = new Map<string, MoveChoice>();
  for (const path of paths) {
    const after = new Map<string, string>();
    for (const tag of storage.get(path).tags) {
      const name = renamed.get(tagKey(tag)) ?? tag;
      const nameKey = tagKey(name);
      if (nameKey !== null && groupKey(name) === key && !after.has(nameKey)) after.set(nameKey, name);
    }
    if (after.size < 2) continue;
    const tags = [...after.values()].sort((a, b) => collator.compare(a, b));
    const id = tags.map((tag) => tagKey(tag)).join('\n');
    const known = choices.get(id);
    if (known) {
      known.paths.push(path);
      continue;
    }
    const last = (tag: string) => order.get(tagKey(tag)) ?? -1;
    const kept = tags.reduce((best, tag) => (last(tag) > last(best) ? tag : best));
    choices.set(id, { tags, kept, paths: [path] });
  }
  return [...choices.values()].sort(
    (a, b) => b.paths.length - a.paths.length || collator.compare(a.tags.join('\n'), b.tags.join('\n')),
  );
}

/**
 * Files that would lose a tag when group `from` merges into exclusive group `to`: after the move a file would
 * have more than one distinct tag of `to` (its own plus the moved "<to>/<short name>"), and each tagging in
 * such a group removes siblings (`renameGroup` → `renameTag` → `addTags`). Nothing if `to` has no flag.
 */
export function mergeConflicts(
  storage: Pick<BubaStorage, 'allTags' | 'filesWithTag' | 'get' | 'groupSettings'>,
  from: string,
  to: string,
): string[] {
  const source = tagKey(from);
  const target = tagKey(to);
  const into = normalizeTag(to);
  if (source === null || target === null || into === null || !storage.groupSettings(target).exclusive)
    return [];
  const members = storage
    .allTags()
    .map(({ tag }) => tag)
    .filter((tag) => groupKey(tag) === source);
  const paths = new Set(members.flatMap((tag) => storage.filesWithTag(tag)));
  return [...paths].filter((path) => {
    const after = new Set<string | null>();
    for (const tag of storage.get(path).tags) {
      const group = groupKey(tag);
      if (group === target) after.add(tagKey(tag));
      else if (group === source) after.add(tagKey(`${into}/${shortName(tag)}`));
    }
    return after.size > 1;
  });
}

/** A swap in an exclusive group: short names of the removed siblings and on how many files they go. */
export interface ExclusiveSwap {
  replaced: string[];
  files: number;
}

/**
 * What tagging `paths` with `tag` will swap: a tag from an exclusive group removes the visible siblings of
 * its group (a notice like "done" instead of "in progress"). Nothing without a group or without the flag.
 */
export function exclusiveSwap(
  storage: Pick<BubaStorage, 'get' | 'groupSettings'>,
  paths: readonly string[],
  tag: string,
): ExclusiveSwap {
  const key = tagKey(tag);
  const group = groupKey(tag);
  if (key === null || group === null || !storage.groupSettings(group).exclusive)
    return { replaced: [], files: 0 };
  const replaced = new Map<string, string>();
  let files = 0;
  for (const path of new Set(paths)) {
    const tags = storage.get(path).tags;
    if (tags.some((other) => tagKey(other) === key)) continue;
    const others = tags.filter((other) => groupKey(other) === group);
    if (!others.length) continue;
    files += 1;
    for (const other of others) {
      const short = shortName(other);
      const otherKey = tagKey(short) ?? short;
      if (!replaced.has(otherKey)) replaced.set(otherKey, short);
    }
  }
  return { replaced: [...replaced.values()], files };
}

/** Pinned colors of the color window: storage `meta.set` lines (`kind: 'palette'`), shared across devices. */
export function pinnedColorsOf(storage: Pick<BubaStorage, 'pinnedColors' | 'setColorPinned'>): PinnedColors {
  return {
    list: () => storage.pinnedColors(),
    pin: (value) => storage.setColorPinned(value, true),
    unpin: (value) => storage.setColorPinned(value, false),
  };
}
