// Tag dialog: case-insensitive search and "Create tag"; the chosen tag goes to every file of the batch in one
// storage write. It is Obsidian's `SuggestModal`, like quick switcher and the command palette
// (https://docs.obsidian.md/Reference/TypeScript+API/SuggestModal): a flat list with no group submenus. The
// order matches the "All tags" tree (`suggestTags`): groups by name, each with its tags, then ungrouped tags;
// with an empty query each tag appears once, with no recent-tags block; typing a group name puts its tags
// first. Rows use Obsidian's suggestion classes: the color dot in the `suggestion-icon` cell, the short name,
// the group and count muted on the right (`suggestion-aux`, `suggestion-flair`); dot gap, group size, count
// column and "name in color" are in picker.css. Rows go up to Obsidian's `limit` (100 by default), so an
// 80-tag group is fully visible. Typing filters without delay, like Obsidian's suggesters. Tags and counts
// come from the "All tags" list (listed.ts): a tag only on deleted files is absent and its name offers
// "Create". Tags are rendered as text only.
import { Notice, SuggestModal, type App } from 'obsidian';
import type { BubaStorage, TagCount } from '../../core/storage/types.ts';
import { t } from '../../core/i18n/dict/tags.ts';
import { quoted } from '../../core/tags/copy.ts';
import { exclusiveSwap } from '../../core/tags/group-plan.ts';
import { colorCss } from '../../core/color/value.ts';
import { groupKey, shortName, tagGroup } from '../../core/tags/groups.ts';
import { suggestTags, type TagSuggestion } from '../../core/tags/suggest.ts';
import { contrastClasses, tagDot } from '../color/dot.ts';
import { assignmentNotice } from './assignment-notice.ts';
import { listedTags } from './listed.ts';
import './picker.css';

/**
 * Puts the color on a row element for "name in color" (picker.css): `--buba-color` is set only after
 * `colorCss`, and a hard-to-see color gets `mod-low-contrast-<theme>`, like rows of the "All tags" tree. Not
 * a color: nothing.
 */
function markColor(el: HTMLElement, value: unknown): void {
  const css = colorCss(value);
  if (css === null) return;
  el.addClass('mod-tag-color', ...contrastClasses(value));
  el.setCssProps({ '--buba-color': css });
}

export class TagPickerModal extends SuggestModal<TagSuggestion> {
  readonly #storage: BubaStorage;
  readonly #paths: readonly string[];
  // Tags are snapshotted once on open, not on every keystroke: core remembers the order (`orderTags`) for
  // this snapshot, and typing only filters it.
  readonly #all: TagCount[];

  constructor(app: App, storage: BubaStorage, paths: readonly string[]) {
    super(app);
    this.#storage = storage;
    this.#paths = paths;
    this.#all = listedTags(app, storage);
    this.setPlaceholder(t('tagPickPlaceholder'));
    this.emptyStateText = t('tagPickEmpty');
  }

  override getSuggestions(query: string): TagSuggestion[] {
    return suggestTags(query, this.#all, this.limit);
  }

  override renderSuggestion(item: TagSuggestion, el: HTMLElement): void {
    el.addClass('mod-complex', 'buba-tag-picker-item');
    if (item.isNew) {
      el.createDiv({ cls: 'suggestion-content' })
        .createDiv({ cls: 'suggestion-title' })
        .setText(t('createTagChoice', { tag: item.tag }));
      return;
    }
    const color = this.#storage.tagColor(item.tag);
    tagDot(el.createDiv({ cls: 'suggestion-icon' }), color);
    el.createDiv({ cls: 'suggestion-content' })
      .createDiv({ cls: 'suggestion-title' })
      .setText(shortName(item.tag));
    markColor(el, color);
    const aux = el.createDiv({ cls: 'suggestion-aux' });
    const group = tagGroup(item.tag);
    const key = groupKey(item.tag);
    if (group !== null && key !== null) {
      const flair = aux.createSpan({ cls: 'suggestion-flair buba-tag-picker-group', text: group });
      markColor(flair, this.#storage.groupSettings(key).color);
    }
    aux.createSpan({ cls: 'suggestion-flair buba-tag-picker-count', text: String(item.count) });
  }

  override onChooseSuggestion(item: TagSuggestion): void {
    void tagFiles(this.app, this.#storage, this.#paths, item.tag);
  }
}

/** Opens the tag dialog for a batch of paths; used by the file menu item, the file panel and the T key. */
export function openTagPicker(app: App, storage: BubaStorage, paths: readonly string[]): void {
  new TagPickerModal(app, storage, paths).open();
}

/**
 * Adds the tag to every file of the batch in one storage write, then shows a notice with the file count. If a
 * tag of an exclusive group replaced a visible sibling, the notice says so (e.g. "done" instead of "in
 * progress").
 */
export async function tagFiles(
  app: App,
  storage: BubaStorage,
  paths: readonly string[],
  tag: string,
): Promise<void> {
  const swap = exclusiveSwap(storage, paths, tag);
  const explain = assignmentNotice(app, storage, paths);
  try {
    await storage.addTags([...paths], [tag]);
  } catch (error) {
    console.error('Buba: tag not added', error);
    new Notice(t('tagFailed', { tag }));
    return;
  }
  const explanation = explain();
  if (swap.files) {
    const replaced = quoted(swap.replaced);
    new Notice(`${t('swapped', { tag: shortName(tag), replaced, count: swap.files })}${explanation}`, 10_000);
    return;
  }
  new Notice(`${t('tagged', { tag, count: paths.length })}${explanation}`, explanation ? 10_000 : undefined);
}
