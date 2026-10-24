// The "All tags" list in the Buba tree, like Obsidian's Tags view (https://obsidian.md/help/plugins/tags) and
// "All Tags" in Eagle: all tags with file counts; search over them is a case-insensitive substring match, the
// same filter as the tags window (`matchTags`). Tags with a group form a tree, like nested tags in Obsidian's
// Tags view (https://obsidian.md/help/tags#Nested+tags): a group row with its tags under it by short name.
// The order matches the tags window (`orderTags`): groups by name, each with its tags by name, then ungrouped
// tags by name. No `obsidian` import, checked by `node --test`.
import type { ColorValue } from '../color/value.ts';
import { tagKey, type BubaStorage, type TagCount, type TagStorage, type TagTally } from '../storage/types.ts';
import { groupKey, tagGroup } from './groups.ts';
import { matchTags, type OrderedTag } from './order.ts';
import type { TagGroupSource, TagSource } from './sources.ts';

const collator = new Intl.Collator('ru', { numeric: true });

/**
 * What the tag list needs from storage: file records and declared tags; tree
 * counts from index records (`tagTally`) if storage provides them. A storage
 * fake in tests may lack them; counts then come from a pass over file records.
 */
export type TagCountSource = Pick<TagStorage, 'get' | 'declaredTags' | 'tagTally'>;

/**
 * Tags of the files `paths` that exist in the vault, with the number of such files: as many tiles as the
 * tag's grid will show. Storage keeps records of deleted and vanished files (bring a file back and its tags
 * return), but they are not counted. A declared tag stays in the list without files, with count 0: a tag
 * lives until it is deleted; a tag only on vanished files and not declared is not listed, as in Obsidian's
 * Tags view. One pass over the files: `filesWithTag` per tag would scan all records once per tag. `exists`
 * checks the same `paths` if the caller already has such a check.
 */
export function existingTagCounts(
  paths: Iterable<string>,
  storage: TagCountSource,
  exists?: (path: string) => boolean,
): TagCount[] {
  return existingTreeCounts(paths, storage, exists).tags;
}

/**
 * Tag tree counts: tags as in `existingTagCounts`; groups map a group key to the files with any of its tags;
 * titles map a group key to its name as spelled by its alphabetically first tag, over all tags rather than
 * those found by search, so the group row keeps its spelling while searching.
 */
export interface TagTreeCounts {
  tags: TagCount[];
  groups: Map<string, number>;
  titles: Map<string, string>;
}

/**
 * Tag and group counts and group names in the same single pass over files: a file with two tags of a group
 * counts once for the group, as many tiles as the group's grid will show. Keys of a tag and its group are
 * computed once per spelling: there are thousands of spellings but hundreds of thousands of occurrences, and
 * name parsing uses regexes (like `RecordIndex.group`); at 50k files parsing per occurrence doubled the pass.
 * The group name comes from its alphabetically first tag, compared once per new tag without sorting all tags.
 * After the pass, declared tags absent from files are added with count 0; a group made only of them has count
 * 0. If storage provides counts from index records (`tagTally`), those are used: a key pass without per-path
 * records is twice as fast (about 60 ms instead of 126–168 ms at 50k files); paths become the existence
 * check, or `exists` if the caller has one.
 */
export function existingTreeCounts(
  paths: Iterable<string>,
  storage: TagCountSource,
  exists?: (path: string) => boolean,
): TagTreeCounts {
  if (storage.tagTally) return treeOf(storage.tagTally(exists ?? existsIn(paths)));
  const items = new Map<string, TagCount>();
  const groups = new Map<string, GroupSlot>();
  const known = new Map<string, { item: TagCount; group: GroupSlot | null } | null>();
  /** A new spelling: its tag (one per key across spellings) and its group counter. */
  const learn = (tag: string): { item: TagCount; group: GroupSlot | null } | null => {
    const key = tagKey(tag);
    if (key === null) return null;
    let item = items.get(key);
    const fresh = item === undefined;
    if (item === undefined) items.set(key, (item = { tag, count: 0 }));
    const groupOf = groupKey(tag);
    if (groupOf === null) return { item, group: null };
    let group = groups.get(groupOf);
    if (group === undefined) groups.set(groupOf, (group = { files: 0, first: tag }));
    else if (fresh && collator.compare(tag, group.first) < 0) group.first = tag;
    return { item, group };
  };
  const counted: GroupSlot[] = [];
  for (const path of paths) {
    counted.length = 0;
    for (const tag of storage.get(path).tags) {
      let slot = known.get(tag);
      if (slot === undefined) known.set(tag, (slot = learn(tag)));
      if (slot === null) continue;
      slot.item.count += 1;
      const { group } = slot;
      if (group === null || counted.includes(group)) continue;
      counted.push(group);
      group.files += 1;
    }
  }
  for (const tag of storage.declaredTags()) if (!known.has(tag)) known.set(tag, learn(tag));
  const files = new Map<string, number>();
  const titles = new Map<string, string>();
  for (const [key, { files: n, first }] of groups) {
    files.set(key, n);
    titles.set(key, tagGroup(first) ?? key);
  }
  return { tags: [...items.values()], groups: files, titles };
}

/** Group counter of the pass: files with any of its tags, and its alphabetically first tag for the name. */
interface GroupSlot {
  files: number;
  first: string;
}

/** Existence check over the paths as a set, built once per call. */
function existsIn(paths: Iterable<string>): (path: string) => boolean {
  const known = new Set(paths);
  return (path) => known.has(path);
}

/** Tree counts from storage counts: group names from the alphabetically first tag, as in the record pass. */
function treeOf({ tags, groups, members }: TagTally): TagTreeCounts {
  const titles = new Map<string, string>();
  for (const [key, names] of members) {
    let first = names[0] ?? key;
    for (const name of names) if (collator.compare(name, first) < 0) first = name;
    titles.set(key, tagGroup(first) ?? key);
  }
  return { tags, groups, titles };
}

export interface TagListItem {
  /** By tag key: a tag in any case is one item. */
  id: string;
  title: string;
  /** Number of files with the tag. */
  count: number;
  source: TagSource;
}

/**
 * In `orderTags` order: groups, then ungrouped tags, by name with numbers by value ("Clip 2" before "Clip
 * 10"), because in a long list tags are found by eye. An empty query gives all tags; a non-empty one
 * everything `matchTags` keeps, without a "Create" item: there is nothing to create in the tag list.
 */
export function tagListItems(all: readonly TagCount[], query: string): TagListItem[] {
  return matchTags(all, query).map(({ item: { tag, count }, key }) => ({
    id: `tag:${key}`,
    title: tag,
    count,
    source: { kind: 'tag', tag },
  }));
}

/** A group row of the "All tags" tree. */
export interface TagGroupRow {
  kind: 'group';
  /** `group:<group key>`. */
  id: string;
  /** Group key (`tagKey`), for collapsed state and settings. */
  key: string;
  /** Group name as spelled by its alphabetically first tag. */
  title: string;
  /** Files with any tag of the group. */
  count: number;
  exclusive: boolean;
  color: ColorValue | null;
  /** Whether it can collapse: while searching, groups with found tags are always expanded. */
  collapsible: boolean;
  expanded: boolean;
  source: TagGroupSource;
}

/** A tag row: an ungrouped tag at the top level by full name, a grouped one under its group by short name. */
export interface TagRow {
  kind: 'tag';
  /** `tag:<tag key>`. */
  id: string;
  /** Full tag name. */
  tag: string;
  title: string;
  depth: 0 | 1;
  count: number;
  color: ColorValue | null;
  source: TagSource;
}

export type TagTreeRow = TagGroupRow | TagRow;

/**
 * Rows of the "All tags" tree for a query: tags filtered by `matchTags` (the group name is part of the tag
 * name, so "status" finds all tags of the group) in one pass over its order: a group change emits a group
 * row, with its tags under it by short name; ungrouped tags follow by full name. Group names come from the
 * counts (`titles`), over all its tags. Tags of a collapsed group are omitted; while searching, groups are
 * expanded. Groups and tags have their own colors, without inheritance; the flag belongs to the group.
 */
export function tagTreeRows(
  counts: TagTreeCounts,
  query: string,
  open: ReadonlySet<string>,
  settings: Pick<BubaStorage, 'groupSettings' | 'tagColor'>,
): TagTreeRow[] {
  const searching = tagKey(query) !== null;
  const rows: TagTreeRow[] = [];
  const tagRow = ({ item, key }: OrderedTag<TagCount>, title: string, depth: 0 | 1): TagRow => ({
    kind: 'tag',
    id: `tag:${key}`,
    tag: item.tag,
    title,
    depth,
    count: item.count,
    color: settings.tagColor(item.tag),
    source: { kind: 'tag', tag: item.tag },
  });
  let group: string | null = null;
  let expanded = false;
  for (const entry of matchTags(counts.tags, query)) {
    if (entry.group === null) {
      rows.push(tagRow(entry, entry.item.tag, 0));
      continue;
    }
    if (entry.group !== group) {
      group = entry.group;
      const title = counts.titles.get(group) ?? tagGroup(entry.item.tag) ?? group;
      const { exclusive, color } = settings.groupSettings(group);
      expanded = searching || open.has(group);
      rows.push({
        kind: 'group',
        id: `group:${group}`,
        key: group,
        title,
        count: counts.groups.get(group) ?? 0,
        exclusive,
        color,
        collapsible: !searching,
        expanded,
        source: { kind: 'tag-group', group: title },
      });
    }
    if (expanded) rows.push(tagRow(entry, entry.short, 1));
  }
  return rows;
}

/**
 * Expanded groups from the device's local storage: group keys; anything but a list of strings expands none.
 */
export function readOpenGroups(saved: unknown): Set<string> {
  if (!Array.isArray(saved)) return new Set();
  const keys = saved.map((item) => (typeof item === 'string' ? tagKey(item) : null));
  return new Set(keys.filter((key): key is string => key !== null));
}

/** Expands a collapsed group or collapses an expanded one: returns a new key set. */
export function toggleOpenGroup(open: ReadonlySet<string>, group: string): Set<string> {
  const key = tagKey(group);
  const next = new Set(open);
  if (key === null) return next;
  if (!next.delete(key)) next.add(key);
  return next;
}

/**
 * Model of the "All tags" list: the text in the search field. The field is redrawn on every expand, so the
 * model holds the query rather than the field, like Obsidian's Tags pane keeps `searchQuery` in its view
 * state. Lives while the plugin is loaded; not kept across restarts.
 */
export interface TagList {
  /** Exactly what was typed, spaces included: it goes back into a new field. */
  query(): string;
  setQuery(text: string): void;
  /** List rows for the typed query. */
  items(all: readonly TagCount[]): TagListItem[];
}

export function createTagList(): TagList {
  let query = '';
  return {
    query: () => query,
    setQuery(text) {
      query = text;
    },
    items: (all) => tagListItems(all, query),
  };
}
