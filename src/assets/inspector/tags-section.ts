// "Tags" panel section (`buba-tags`, order 30): the tags of the shown files as chips, like the tags field in
// Obsidian's "Properties" and the Eagle inspector; for several files a tag also shows "N of M". A click on a
// tag opens the grid of its files, the cross removes the tag from all shown files, and the round "+" ("Add
// tag") opens the tags window for them. A chip has the tag's color dot (grey without a color) and the group
// as a muted prefix; group and color come from `src/core` and the storage contract. A tag is text only; a
// color is used only after the pattern check.
import { ButtonComponent, ExtraButtonComponent, Notice, type Plugin } from 'obsidian';
import { t } from '../../core/i18n/dict/inspector.ts';
import { tagKey, type BubaStorage } from '../../core/storage/types.ts';
import { shortName, tagGroup } from '../../core/tags/groups.ts';
import type { TagSource } from '../../core/tags/sources.ts';
import { summarize } from '../../core/tags/summary.ts';
import { iconButton } from '../../platform/icon-button.ts';
import type { BubaAssets } from '../api.ts';
import { tagDot } from '../color/dot.ts';
import { openTagPicker } from '../tags/picker.ts';
import type { InspectorSection } from './sections.ts';
import type { PanelFollow } from './follow.ts';
import './tags-rating.css';

export const TAGS_SECTION_ID = 'buba-tags';

/** Storage is the plugin's `storage` field; read on every draw. */
function storageOf(plugin: Plugin): BubaStorage | undefined {
  return (plugin as Plugin & { storage?: BubaStorage }).storage;
}

/**
 * A section for the storage records of the shown files: a heading with `draw` below it; without storage,
 * "Storage is not open". Redraws when storage reports a change to a shown path; the unsubscribe runs on
 * section cleanup.
 */
export function storageSection(
  plugin: Plugin,
  id: string,
  order: number,
  title: string,
  draw: (el: HTMLElement, storage: BubaStorage, paths: string[]) => void,
  onChange?: (listener: () => void) => () => void,
): InspectorSection {
  return {
    id,
    order,
    render(el, paths) {
      el.createDiv({ cls: 'buba-storage-heading', text: title });
      const body = el.createDiv();
      const storage = storageOf(plugin);
      if (!storage) {
        body.createDiv({ cls: 'buba-storage-note', text: t('storageClosed') });
        return;
      }
      const shown = new Set(paths);
      const redraw = (): void => {
        body.empty();
        draw(body, storage, paths);
      };
      redraw();
      const off = storage.onChange((changed) => {
        if (changed.some((path) => shown.has(path))) redraw();
      });
      const offSource = onChange?.(redraw);
      return () => {
        off();
        offSource?.();
      };
    },
  };
}

/** A click on a tag opens its grid through `assets` with the same call as a row of the tags tree. */
export function tagsSection(
  plugin: Plugin,
  assets: Pick<BubaAssets, 'openGrid'>,
  source?: Partial<Pick<PanelFollow, 'currentTag' | 'onSourceChange'>>,
): InspectorSection {
  return storageSection(
    plugin,
    TAGS_SECTION_ID,
    30,
    t('tagsTitle'),
    (el, storage, paths) => {
      const { files, tags } = summarize(paths.map((path) => storage.get(path)));
      const list = el.createDiv({ cls: 'buba-tags' });
      const current = source?.currentTag?.() ?? null;
      for (const { tag, count } of tags) {
        const selected = tagKey(tag) === current;
        const chip = list.createDiv({ cls: selected ? 'buba-tag is-source' : 'buba-tag' });
        if (selected) chip.setAttr('aria-current', 'true');
        const dot = tagDot(chip, storage.tagColor(tag));
        // Dot, name, count and cross sit a whole number of pixels from the chip top (tags-rating.css).
        const name = chip.createSpan({ cls: 'buba-tag-name buba-text-center', attr: { 'aria-label': tag } });
        const group = tagGroup(tag);
        if (group !== null) name.createSpan({ cls: 'buba-tag-chip-group', text: `${group}/` });
        name.createSpan({ text: shortName(tag) });
        const countEl =
          files > 1
            ? chip.createSpan({
                cls: 'buba-tag-count buba-text-center',
                text: t('tagShare', { count, total: files }),
              })
            : null;
        // On a phone the gap before the cross is its own "open grid" tap target; on desktop there is none.
        const gap = chip.createSpan({ cls: 'buba-tag-gap', attr: { 'aria-hidden': 'true' } });
        // The cross is part of the chip in the tag's color (tags-rating.css), not a Buba icon button.
        new ExtraButtonComponent(chip)
          .setIcon('x')
          .setTooltip(t('removeTag', { tag }))
          .onClick(() => void untag(storage, paths, tag));
        onTagClick(chip, [dot, name, countEl, gap], () => openTag(assets, tag));
      }
      // Round plus button as tall as a tag: icon and tooltip are the standard `setIcon` and `setTooltip` of
      // an Obsidian button, the look is in tags-rating.css.
      const add = new ButtonComponent(list)
        .setIcon('plus')
        .setTooltip(t('addTag'))
        .setClass('buba-tag-add')
        .setClass('buba-tag-add-round')
        .onClick(() => openTagPicker(plugin.app, storage, paths));
      iconButton(add.buttonEl, 'filled');
    },
    source?.onSourceChange,
  );
}

/**
 * A click anywhere on the chip except the cross (dot, name, count, padding, gaps) opens the tag, like the tag
 * pill in Obsidian's "Properties" (Obsidian 1.13 listens on the whole pill); there are no dead zones.
 *
 * The handler is on the chip (its padding and gaps) and on each part (`parts`: dot, name, count, the spacer
 * in the gap before the cross). The parts are tap targets themselves: Chromium's touch adjustment skips a
 * target that contains another target (`touch_adjustment.cc` prefers the inner handler), and with a single
 * handler on the chip a tap on a short name went to the cross and removed the tag; so did a tap in the gap on
 * a phone while the gap was the chip itself.
 *
 * Not handled: the cross, whose click Obsidian cancels with `preventDefault` (`ExtraButtonComponent`) so it
 * only removes the tag; the second click of a double click, since the first already opened the grid, as for a
 * tag row in the "All tags" tree (`tag-list.ts`); and a click that ends a text selection started or ended in
 * the chip, so the name can be copied.
 */
function onTagClick(chip: HTMLElement, parts: (HTMLElement | null)[], open: () => void): void {
  const handle = (evt: MouseEvent): void => {
    if (evt.defaultPrevented || evt.detail > 1) return;
    const selection = chip.win.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      (chip.contains(selection.anchorNode) || chip.contains(selection.focusNode))
    )
      return;
    open();
  };
  // A click on a part was handled by the part; the chip keeps its padding and gaps.
  chip.addEventListener('click', (evt) => {
    if (evt.target === chip) handle(evt);
  });
  for (const part of parts) part?.addEventListener('click', handle);
}

/**
 * Opens the grid of the tag's files in the center with a `tag` source, like a tag row in the "All tags" tree.
 * The `openGrid` queue (src/assets/index.ts) finds or opens the grid leaf, also from a file view.
 */
function openTag(assets: Pick<BubaAssets, 'openGrid'>, tag: string): void {
  const source: TagSource = { kind: 'tag', tag };
  assets.openGrid(source).catch((error: unknown) => console.error('Buba: tag grid did not open', error));
}

/** Removes the tag from all shown files in one storage write. */
async function untag(storage: BubaStorage, paths: string[], tag: string): Promise<void> {
  try {
    await storage.removeTags(paths, [tag]);
  } catch (error) {
    console.error('Buba: tag not removed', error);
    new Notice(t('removeTagFailed', { tag }));
  }
}
