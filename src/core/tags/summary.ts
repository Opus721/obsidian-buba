// Tags and rating of the shown files for the file panel: one file shows its own, several show a summary whose
// edits apply to all of them (like Multi Properties and Eagle's batch edit). Tags merge by `tagKey` in the
// spelling met first. No `obsidian` import, checked by `node --test`.
import { tagKey, type FileRecord, type Rating, type TagCount } from '../storage/types.ts';

export interface TagsSummary {
  /** How many files are summarized. */
  files: number;
  /**
   * Tags of all files; `count` is how many files have the tag. Sorted by `count` descending, then by name.
   */
  tags: TagCount[];
  /** Shared rating of all files (0 if all are unrated); `null` if ratings differ or there are no files. */
  rating: Rating | null;
}

const collator = new Intl.Collator('ru', { numeric: true });

export function summarize(records: readonly FileRecord[]): TagsSummary {
  const byKey = new Map<string, TagCount>();
  for (const record of records) {
    // A tag counts once per file, even if the file has it twice in different spellings.
    const seen = new Set<string>();
    for (const tag of record.tags) {
      const key = tagKey(tag);
      if (key === null || seen.has(key)) continue;
      seen.add(key);
      const item = byKey.get(key);
      if (item) item.count++;
      else byKey.set(key, { tag, count: 1 });
    }
  }
  const tags = [...byKey.values()].sort((a, b) => b.count - a.count || collator.compare(a.tag, b.tag));
  const [first, ...rest] = records;
  const rating = first && rest.every((record) => record.rating === first.rating) ? first.rating : null;
  return { files: records.length, tags, rating };
}

/**
 * A click on star `clicked`: on the current rating's star it clears it, as in Eagle; otherwise it sets it.
 */
export function toggleRating(current: Rating | null, clicked: Exclude<Rating, 0>): Rating {
  return clicked === current ? 0 : clicked;
}
