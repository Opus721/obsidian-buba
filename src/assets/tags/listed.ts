// One tag list for all dialogs: the one the "All tags" tree shows, i.e. tags on existing files plus declared
// tags with count 0. The tag dialog, the rename picker, "New tag" and confirmation counts all use it, just as
// Obsidian has one tag source for everything (`metadataCache.getTags()` feeds both the tags pane and search
// suggestions). The "All tags" item (tag-list.ts) registers the list per app, with the tree's counts cached
// until the next storage or file index change; until then all stored tags (`allTags`) are used.
// Merge-or-rename decisions and the writes themselves go over every index record: that is a plan, not a list
// (src/core/tags).
import type { App } from 'obsidian';
import { tagKey, type TagCount, type TagStorage } from '../../core/storage/types.ts';

const lists = new WeakMap<object, () => TagCount[]>();

const keyOf = (app: App): object | null => (typeof app === 'object' && app !== null ? app : null);

/** Registers the "All tags" list for dialogs of `app`; returns the unregister call used on plugin unload. */
export function setListedTags(app: App, list: () => TagCount[]): () => void {
  const key = keyOf(app);
  if (key === null) return () => {};
  lists.set(key, list);
  return () => {
    if (lists.get(key) === list) lists.delete(key);
  };
}

/**
 * Tags for dialogs: the "All tags" list, or all stored tags until it is registered. Do not mutate the array.
 */
export function listedTags(app: App, storage: Pick<TagStorage, 'allTags'>): TagCount[] {
  const key = keyOf(app);
  const list = key === null ? undefined : lists.get(key);
  return list ? list() : storage.allTags();
}

/** Number of existing files with `tag` according to the list; 0 if the tag is not listed. */
export function listedFiles(app: App, storage: Pick<TagStorage, 'allTags'>, tag: string): number {
  const key = tagKey(tag);
  return listedTags(app, storage).find((item) => tagKey(item.tag) === key)?.count ?? 0;
}
