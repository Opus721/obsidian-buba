// "Copy tags" and "Paste tags": what a file copies, what paste sets on which files, and the notice texts. As
// in Eagle ("Copy Tags" and "Paste Tags"): the visible tags of one file are copied, without the rating; paste
// adds them to the batch with one storage write (`addTags`), and a tag of an exclusive group replaces its
// sibling, as when tagging. Tags gone since copying (deleted or renamed) are not pasted, so a deleted tag
// does not come back. No `obsidian` import, checked by `node --test`.
import { tagKey, type BubaStorage, type TagDeclarations } from '../storage/types.ts';
import { t } from '../i18n/dict/tags.ts';
import { exclusiveSwap } from './group-plan.ts';
import { groupKey, shortName } from './groups.ts';

/** What was copied: the visible tags of file `from` at copy time. */
export interface CopiedTags {
  from: string;
  tags: string[];
}

/** "Copy tags" of file `path`: its visible tags; `null` if it has none and there is nothing to copy. */
export function copyTags(storage: Pick<BubaStorage, 'get'>, path: string): CopiedTags | null {
  const { tags } = storage.get(path);
  return tags.length ? { from: path, tags: [...tags] } : null;
}

/** A swap in an exclusive group: the tag set, short names of the removed siblings, and on how many files. */
export interface PasteSwap {
  tag: string;
  replaced: string[];
  files: number;
}

/** What "Paste tags" will do. */
export interface PastePlan {
  /** Tags for `addTags`, in copy order. */
  tags: string[];
  /** Tags that no longer exist: deleted or renamed after copying. */
  skipped: string[];
  /** Files in the batch. */
  files: number;
  /** How many of them the paste changes; 0 means nothing to write. */
  changed: number;
  swaps: PasteSwap[];
}

type PasteStorage = Pick<BubaStorage, 'get' | 'filesWithTag' | 'groupSettings'> &
  Pick<TagDeclarations, 'declaredTags'>;

/**
 * Plan for pasting `copied` onto `paths`. A tag is alive if it is declared: deleting and
 * renaming remove the declaration. A tag set by builds before 0.5.0 and untouched since has no
 * declaration line; it is alive while the source file has it, or else any file (`filesWithTag`,
 * a scan over records only for such a tag). Of several tags of one exclusive group the last one
 * is set, as in `addTags`; the group may have become exclusive after copying.
 */
export function planPaste(storage: PasteStorage, copied: CopiedTags, paths: readonly string[]): PastePlan {
  const declared = new Set(storage.declaredTags().map(tagKey));
  const source = new Set(storage.get(copied.from).tags.map(tagKey));
  const alive = (tag: string): boolean => {
    const key = tagKey(tag);
    return declared.has(key) || source.has(key) || storage.filesWithTag(tag).length > 0;
  };
  const live = copied.tags.filter(alive);
  const skipped = copied.tags.filter((tag) => !live.includes(tag));
  const exclusiveOf = (tag: string): string | null => {
    const group = groupKey(tag);
    return group !== null && storage.groupSettings(group).exclusive ? group : null;
  };
  const last = new Map<string, string>();
  for (const tag of live) {
    const group = exclusiveOf(tag);
    if (group !== null) last.set(group, tag);
  }
  const tags = live.filter((tag) => {
    const group = exclusiveOf(tag);
    return group === null || last.get(group) === tag;
  });
  const unique = [...new Set(paths)];
  const keys = tags.map(tagKey);
  const changed = unique.filter((path) => {
    const shown = new Set(storage.get(path).tags.map(tagKey));
    return keys.some((key) => !shown.has(key));
  }).length;
  const swaps = tags
    .map((tag) => ({ tag, ...exclusiveSwap(storage, unique, tag) }))
    .filter((swap) => swap.files > 0);
  return { tags, skipped, files: unique.length, changed, swaps };
}

/** A tag list in the language's quotes: "background", "sky". */
export const quoted = (tags: readonly string[]): string => tags.map((tag) => t('quoted', { tag })).join(', ');

/** Copy notice: `Copied tag "background"`, `Copied tags (2): "reference", "Clip 3"`. */
export function copyNotice(tags: readonly string[]): string {
  const [first] = tags;
  return tags.length === 1 && first !== undefined
    ? t('copiedOne', { tag: first })
    : t('copiedMany', { count: tags.length, tags: quoted(tags) });
}

/**
 * Paste notice as lines (Obsidian notices show line breaks): what was pasted
 * and to how many files, swaps in exclusive groups (worded like the tags
 * window, "done" instead of "in progress"), and which tags were skipped.
 */
export function pasteNotice(plan: PastePlan): string {
  const one = plan.skipped.length === 1;
  const skipped = quoted(plan.skipped);
  const [first] = plan.tags;
  if (first === undefined) return t(one ? 'notPastedOne' : 'notPastedMany', { tags: skipped });
  const out: string[] = [];
  if (!plan.changed) out.push(t(plan.files === 1 ? 'fileHasTags' : 'filesHaveTags'));
  else if (plan.tags.length === 1) out.push(t('pasted', { tag: first, count: plan.files }));
  else out.push(t('pastedMany', { tagCount: plan.tags.length, count: plan.files }));
  for (const swap of plan.swaps)
    out.push(t('swapped', { tag: shortName(swap.tag), replaced: quoted(swap.replaced), count: swap.files }));
  if (plan.skipped.length) out.push(t(one ? 'skippedOne' : 'skippedMany', { tags: skipped }));
  return out.join('\n');
}
