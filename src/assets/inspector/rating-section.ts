// "Rating" panel section (`buba-rating`, order 40): five stars, as in the Eagle inspector. A click sets the
// rating on all shown files; a click on the star of their common rating clears it. When the files' ratings
// differ, the stars are empty.
import { Notice, setIcon, type Plugin } from 'obsidian';
import { t } from '../../core/i18n/dict/inspector.ts';
import type { BubaStorage, Rating } from '../../core/storage/types.ts';
import { summarize, toggleRating } from '../../core/tags/summary.ts';
import { iconButton } from '../../platform/icon-button.ts';
import type { InspectorSection } from './sections.ts';
import { storageSection } from './tags-section.ts';
import './tags-rating.css';

export const RATING_SECTION_ID = 'buba-rating';

const STARS = [1, 2, 3, 4, 5] as const;

export function ratingSection(plugin: Plugin): InspectorSection {
  return storageSection(plugin, RATING_SECTION_ID, 40, t('ratingTitle'), (el, storage, paths) => {
    const { rating } = summarize(paths.map((path) => storage.get(path)));
    const stars = el.createDiv({ cls: 'buba-rating' });
    for (const n of STARS) {
      // "N of 5" is the button name for screen readers and Obsidian's hover tooltip.
      const star = stars.createEl('button', {
        cls: 'clickable-icon buba-rating-star',
        attr: { 'aria-label': t('ratingStars', { stars: n }) },
      });
      iconButton(star);
      star.toggleClass('is-active', rating !== null && n <= rating);
      setIcon(star, 'star');
      star.addEventListener('click', () => void rate(storage, paths, n));
    }
  });
}

/** Sets the rating of all shown files in one storage write; the current rating is read at click time. */
async function rate(storage: BubaStorage, paths: string[], clicked: Exclude<Rating, 0>): Promise<void> {
  const { rating } = summarize(paths.map((path) => storage.get(path)));
  try {
    await storage.setRating(paths, toggleRating(rating, clicked));
  } catch (error) {
    console.error('Buba: rating not set', error);
    new Notice(t('ratingFailed'));
  }
}
