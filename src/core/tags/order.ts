// One tag order for the "All tags" tree (tag-list.ts) and the T tags window (suggest.ts):
// groups by name first, each with its tags by short name, then tags without a group by name.
// File counts do not affect the order, so the list does not jump when a tag is added or
// removed. A group is the part of the name before the last "/"; groups compare by key,
// case-insensitive: "Status/…" and "status/…" stay together. Names sort alphabetically with
// numbers by value: "Clip 2" before "Clip 10". No `obsidian` import, checked by `node --test`.
import { tagKey } from '../storage/types.ts';
import { groupKey, shortName } from './groups.ts';

const collator = new Intl.Collator('ru', { numeric: true });

/** A tag in the order, parsed once: these keys are used both to filter it and to place it in groups. */
export interface OrderedTag<T extends { tag: string }> {
  item: T;
  /** The tag's `tagKey`. */
  key: string;
  /** Group key (`groupKey`); `null` without a group. */
  group: string | null;
  /** Name without the group (`shortName`); the whole name without a group. */
  short: string;
}

type Entry = OrderedTag<{ tag: string }>;

/**
 * Order cached per tag snapshot: the T window and the tree filter it on every keystroke without re-sorting.
 */
const ready = new WeakMap<object, readonly Entry[]>();

/**
 * Tags `items` in one order. Each name is parsed once and sorted once; at 10,000
 * tags that takes tens of milliseconds, so the order is cached per snapshot: `items`
 * is a tag snapshot (`allTags()` and `existingTreeCounts()` return a new array on
 * every change) and must not be mutated after it is passed. Returns a frozen array.
 */
export function orderTags<T extends { tag: string }>(items: readonly T[]): readonly OrderedTag<T>[] {
  const known = ready.get(items);
  if (known) return known as readonly OrderedTag<T>[];
  const ordered = items
    .map((item) => ({
      item,
      key: tagKey(item.tag) ?? '',
      group: groupKey(item.tag),
      short: shortName(item.tag),
    }))
    .sort(compare);
  ready.set(items, Object.freeze(ordered));
  return ordered;
}

/**
 * Tags whose key contains the query, case-insensitive: the filter of the "All tags" search and the tags
 * window, like Obsidian's `prepareSimpleSearch`; an empty query keeps all. Ordered by `orderTags`.
 */
export function matchTags<T extends { tag: string }>(
  items: readonly T[],
  query: string,
): readonly OrderedTag<T>[] {
  const ordered = orderTags(items);
  const key = tagKey(query);
  return key === null ? ordered : ordered.filter((entry) => entry.key.includes(key));
}

/** Groups before ungrouped tags; groups by name, tags by name within; visually equal names by key. */
function compare(a: Entry, b: Entry): number {
  if (a.group !== b.group) {
    if (a.group === null) return 1;
    if (b.group === null) return -1;
    return collator.compare(a.group, b.group) || (a.group < b.group ? -1 : 1);
  }
  return collator.compare(a.short, b.short) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
