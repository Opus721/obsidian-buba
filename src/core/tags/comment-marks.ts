// Tile marks from a file's comments: none without comments; `has-comment` if there are any; also
// `has-open-comment` (accent icon) if at least one is not marked done; when all are done the icon takes the
// format badge color. No `obsidian` import.
import type { FileComment } from '../storage/types.ts';

export function commentMarks(comments: readonly Pick<FileComment, 'done'>[]): string[] {
  if (comments.length === 0) return [];
  return comments.some((each) => !each.done) ? ['has-comment', 'has-open-comment'] : ['has-comment'];
}
