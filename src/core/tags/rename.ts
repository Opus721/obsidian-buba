// Renaming a tag on all its files. A new name matching another tag merges them, as in Tag
// Wrangler (https://github.com/pjeby/tag-wrangler), with a confirmation dialog; the same
// key in another case is the same tag and is refused. Color and declaration travel with the
// tag, group settings with the group; on a merge the target keeps its settings. A declared
// tag without files is renamed the same way. A name without files or declaration, and a
// group without live tags, are born without old settings; storage takes care of that.
import { t } from '../i18n/dict/tags.ts';
import { normalizeTag, tagKey, type TagCount, type TagStorage } from '../storage/types.ts';
import { groupKey, shortName } from './groups.ts';

/**
 * `to` is the name the files will get: on a merge, in the existing tag's spelling. `files` is how many files
 * already have `to`: the confirmation shows it on a merge; 0 on a rename.
 */
export type RenamePlan =
  { kind: 'rename' | 'merge'; to: string; files: number } | { kind: 'refuse'; reason: string };

export function planRename(from: string, to: string, all: readonly TagCount[]): RenamePlan {
  const name = normalizeTag(to);
  const key = tagKey(to);
  if (name === null || key === null) return { kind: 'refuse', reason: t('emptyName') };
  if (key === tagKey(from)) return { kind: 'refuse', reason: t('sameTag') };
  const existing = all.find((item) => tagKey(item.tag) === key);
  return existing
    ? { kind: 'merge', to: existing.tag, files: existing.count }
    : { kind: 'rename', to: name, files: 0 };
}

/**
 * Moves tag `from` to `to` on all its files according to the plan; a refused plan throws with its text
 * and nothing is written. FIRST the new tag, THEN removing the old one: storage writes them as
 * separate records, and a failure in between leaves files with both tags rather than none. Storage
 * sets a new name without files or declaration "without settings" (no old color of that name and, if
 * the group is empty, no old group flag and color; see `addTags`), so the color of `from` is written
 * to the new tag AFTER the tag itself and cleared from the old name after the tags are removed: a
 * failure in between leaves the color on the old name instead of losing it. On a merge the target
 * keeps its color. Declaration: tagging declares the new name, a tag without files is declared
 * explicitly; the old name's declaration is removed BEFORE the tags are removed, otherwise the removal
 * would declare a tag set before declarations existed and the old name would stay in the list, empty.
 * Moving into or out of a group passes `to` from `groupedName`. Returns the number of files.
 */
export async function renameTag(storage: TagStorage, from: string, to: string): Promise<number> {
  const plan = planRename(from, to, storage.allTags());
  if (plan.kind === 'refuse') throw new RangeError(plan.reason);
  const paths = storage.filesWithTag(from);
  const color = storage.tagColor(from);
  if (paths.length) await storage.addTags(paths, [plan.to]);
  else if (plan.kind === 'rename') await storage.setTagDeclared(plan.to, true);
  if (plan.kind === 'rename') await storage.setTagColor(plan.to, color);
  await storage.setTagDeclared(from, false);
  if (paths.length) await storage.removeTags(paths, [from]);
  if (color !== null) await storage.setTagColor(from, null);
  return paths.length;
}

/**
 * Renames group `from` to `to`: each of its tags, declared ones without files included, goes through
 * `renameTag` to "<to>/<short name>". The group flag and color move to `to` if it has no live tags yet,
 * otherwise `to` keeps its own; `from` loses them. They move whole, a cleared flag and `null` included, AFTER
 * the tags: the first moved tag creates the empty group without settings (`addTags`), and while tags move the
 * new group has no flag, so it removes no siblings (a file shows one tag of an exclusive group, and removing
 * the visible one takes the hidden siblings along). Nested groups ("a/b" inside "a") are separate groups and
 * stay untouched. The same key or an empty name is refused before any write. Returns the number of tags.
 */
export async function renameGroup(storage: TagStorage, from: string, to: string): Promise<number> {
  const source = tagKey(from);
  const into = normalizeTag(to);
  const target = tagKey(to);
  if (source === null || into === null || target === null) throw new RangeError(t('emptyName'));
  if (source === target) throw new RangeError(t('sameGroup'));
  const all = storage.allTags();
  const members = all.filter(({ tag }) => groupKey(tag) === source);
  const settings = storage.groupSettings(source);
  const fresh = !all.some(({ tag }) => groupKey(tag) === target);
  for (const { tag } of members) await renameTag(storage, tag, `${into}/${shortName(tag)}`);
  if (fresh) {
    await storage.setGroupColor(target, settings.color);
    await storage.setGroupExclusive(target, settings.exclusive);
  }
  if (settings.exclusive) await storage.setGroupExclusive(source, false);
  if (settings.color !== null) await storage.setGroupColor(source, null);
  return members.length;
}
