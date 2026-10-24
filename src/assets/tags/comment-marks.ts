// Tile mark for "has comments", with no text or count; a second mark when some comment is not done
// (`commentMarks` in core). Only the requested path is read; redraws reuse the cached answer until that path
// changes in storage. Selection marks use a different key.
import type { Plugin } from 'obsidian';
import type { BubaStorage } from '../../core/storage/types.ts';
import { commentMarks } from '../../core/tags/comment-marks.ts';
import type { BubaAssets, BubaGridView } from '../api.ts';

type CommentStorage = Pick<BubaStorage, 'get' | 'onChange'>;
const KEY = 'comments';

export function registerCommentMarks(
  plugin: Plugin,
  assets: BubaAssets,
  storage: () => CommentStorage | undefined,
): void {
  const answers = new Map<string, string[]>();
  const attached = new Set<BubaGridView>();
  let followed: CommentStorage | undefined;
  let unfollow = (): void => {};
  const current = (): CommentStorage | undefined => {
    const found = storage();
    if (found !== followed) {
      unfollow();
      followed = found;
      answers.clear();
      unfollow =
        found?.onChange((paths) => {
          for (const path of paths) answers.delete(path);
          if (paths.length) for (const view of attached) view.setTileMarks(marks, KEY);
        }) ?? (() => {});
    }
    return found;
  };
  const marks = (path: string): string[] => {
    const found = current();
    let answer = answers.get(path);
    if (answer === undefined) {
      answer = commentMarks(found?.get(path).comments ?? []);
      answers.set(path, answer);
    }
    return answer;
  };
  const install = (): void => {
    current();
    const views = new Set(assets.gridViews());
    for (const view of attached) {
      if (views.has(view)) continue;
      view.setTileMarks(null, KEY);
      attached.delete(view);
    }
    for (const view of views) {
      attached.add(view);
      view.setTileMarks(marks, KEY);
    }
  };
  plugin.app.workspace.onLayoutReady(install);
  plugin.registerEvent(plugin.app.workspace.on('layout-change', install));
  plugin.register(() => {
    unfollow();
    for (const view of attached) view.setTileMarks(null, KEY);
    attached.clear();
    answers.clear();
  });
}
