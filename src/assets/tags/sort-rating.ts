// "By rating" grid sort: the `rating` key in the sort registry, compared by stored star count
// (src/core/tags/sort.ts). Setting stars redraws open grids that use this sort right away.
import type { Plugin, View } from 'obsidian';
import { t } from '../../core/i18n/dict/tags.ts';
import type { BubaStorage } from '../../core/storage/types.ts';
import { compareByRating } from '../../core/tags/sort.ts';
import type { BubaAssets, BubaGridView } from '../api.ts';

const RATING = 'rating';

type RatingStorage = Pick<BubaStorage, 'get' | 'onChange'>;

/**
 * Storage is looked up on every comparison: the plugin's `storage` field may appear after registration, and
 * until then every file has 0 stars. The storage change subscription is set as soon as storage is found, at
 * registration or on the first comparison; plugin unload removes it.
 */
export function registerRatingSort(
  plugin: Pick<Plugin, 'register'>,
  assets: BubaAssets,
  storage: () => RatingStorage | undefined,
): void {
  let followed: RatingStorage | undefined;
  let unfollow = (): void => {};
  const current = (): RatingStorage | undefined => {
    const found = storage();
    if (found !== followed) {
      unfollow();
      followed = found;
      unfollow = found?.onChange(() => refreshRatingGrids(assets)) ?? (() => {});
    }
    return found;
  };
  plugin.register(() => unfollow());
  current();
  assets.registerSortKey(
    RATING,
    t('sortRating'),
    compareByRating((path) => current()?.get(path).rating),
  );
}

/**
 * Redraws grids sorted "By rating" at the first level or in "Then by". The key is read from the Obsidian leaf
 * state where the grid keeps its `GridViewState` (`getState`); a view without leaf state is redrawn, since
 * its sort is unknown.
 */
function refreshRatingGrids(assets: BubaAssets): void {
  for (const view of assets.gridViews()) {
    const state = (view as BubaGridView & Partial<Pick<View, 'getState'>>).getState?.();
    if (state === undefined || state['sort'] === RATING || state['thenSort'] === RATING) view.refresh();
  }
}
