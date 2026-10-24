// Suggestions of the tags window. Filtering is a case-insensitive substring match, like Obsidian's
// `prepareSimpleSearch` (https://docs.obsidian.md/Reference/TypeScript+API/prepareSimpleSearch), in our own
// code: the `obsidian` package ships no code, so `node --test` cannot load it. Case is compared by `tagKey`.
// A tag's group is the part of the name before the last "/". The order matches the "All tags" tree
// (`orderTags`): groups by name, each with its tags, then tags without a group.
import { normalizeTag, tagKey, type TagCount } from '../storage/types.ts';
import { orderTags } from './order.ts';

export interface TagSuggestion {
  /** Spelling: from the index for an existing tag, the typed text after `normalizeTag` for a new one. */
  tag: string;
  /** Number of files with the tag; 0 for a new one. */
  count: number;
  /** No such tag yet: choosing it creates it. */
  isNew: boolean;
}

const existing = ({ tag, count }: TagCount): TagSuggestion => ({ tag, count, isNew: false });

/**
 * Empty query: all tags strictly in "All tags" tree order, each once, up to `limit`, with no recent-tags
 * block on top. Non-empty query: the typed tag first, either the existing one in index spelling or a "Create"
 * item, so Enter after a full name sets exactly that tag; then tags whose key contains the query, in the same
 * order. If a group name is typed and no tag has that name, the group's tags come first, then "Create". The
 * order is cached per `all` snapshot (`orderTags`), so a keystroke only filters.
 */
export function suggestTags(query: string, all: readonly TagCount[], limit = 50): TagSuggestion[] {
  const ordered = orderTags(all);
  const key = tagKey(query);
  if (key === null) return ordered.slice(0, limit).map(({ item }) => existing(item));
  let exact: TagCount | undefined;
  const group: TagCount[] = [];
  const rest: TagCount[] = [];
  for (const entry of ordered) {
    if (!entry.key.includes(key)) continue;
    if (entry.key === key && exact === undefined) exact = entry.item;
    else if (entry.group === key) group.push(entry.item);
    else if (rest.length < limit) rest.push(entry.item);
  }
  const head: TagSuggestion = exact
    ? existing(exact)
    : { tag: normalizeTag(query) ?? query, count: 0, isNew: true };
  const members = group.map(existing);
  return [...(exact ? [head, ...members] : [...members, head]), ...rest.map(existing)].slice(0, limit);
}
