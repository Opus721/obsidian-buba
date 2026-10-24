// For tags the user sets: snapshot the shown views before the write, build the notice after it succeeds.
import type { App } from 'obsidian';
import { GRID_VIEW_TYPE, normalizeGridViewState } from '../../core/layout/view-state.ts';
import { t } from '../../core/i18n/dict/tags.ts';
import type { BubaStorage } from '../../core/storage/types.ts';

/** Notice for files that got their first tag and left a shown "Untagged" view (not their folder). */
export function assignmentNotice(
  app: App,
  storage: Pick<BubaStorage, 'get'>,
  paths: readonly string[],
): () => string {
  const visible = (view: { getState(): unknown; containerEl: HTMLElement }): boolean =>
    normalizeGridViewState(view.getState()).source?.kind === 'untagged' && view.containerEl?.isShown();
  const shown = (app.workspace?.getLeavesOfType?.(GRID_VIEW_TYPE) ?? [])
    .map(({ view }) => ({
      view,
      paths: new Set((view as typeof view & { pathsInOrder?: () => string[] }).pathsInOrder?.() ?? []),
    }))
    .filter(({ view }) => visible(view));
  const candidates = [...new Set(paths)].filter(
    (path) => storage.get(path).tags.length === 0 && shown.some((entry) => entry.paths.has(path)),
  );
  return () => {
    const count = candidates.filter(
      (path) =>
        storage.get(path).tags.length > 0 &&
        app.vault?.getFileByPath?.(path) !== null &&
        shown.some(({ view, paths }) => paths.has(path) && visible(view)),
    ).length;
    if (!count) return '';
    return `\n${count === 1 ? t('leftUntaggedOne') : t('leftUntaggedMany', { count })}`;
  };
}
