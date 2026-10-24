// "Rename tag" command (`buba:rename-tag`): pick a tag → new name → the tag changes on all its files; a new
// name equal to another tag merges them after confirmation, as in Tag Wrangler
// (https://github.com/pjeby/tag-wrangler). The dialogs are Obsidian's `SuggestModal` and `Modal` with a field
// (https://docs.obsidian.md/Plugins/User+interface/Modals). Tags are rendered as text only. Tags include
// those on files and declared ones without files, so an empty tag can also be picked, renamed and merged. The
// pick list and the file count in the merge confirmation come from the "All tags" list (listed.ts); the plan
// and the write go over all index records.
import {
  ButtonComponent,
  Modal,
  Notice,
  Setting,
  SuggestModal,
  type App,
  type Plugin,
  type TextComponent,
} from 'obsidian';
import { t } from '../../core/i18n/dict/tags.ts';
import type { TagCount, TagStorage } from '../../core/storage/types.ts';
import { planRename, renameTag } from '../../core/tags/rename.ts';
import { suggestTags, type TagSuggestion } from '../../core/tags/suggest.ts';
import { listedFiles, listedTags } from './listed.ts';

/** Storage is looked up at call time; until it exists the command is not in the palette. */
export function registerRenameTag(plugin: Plugin, storage: () => TagStorage | undefined): void {
  plugin.addCommand({
    id: 'rename-tag',
    name: t('renameTag'),
    checkCallback: (checking) => {
      const current = storage();
      if (!current) return false;
      if (!checking) openRenameTag(plugin.app, current);
      return true;
    },
  });
}

/** Renames tag `tag`, or asks to pick one first; the tag menu in the tag list calls this too. */
export function openRenameTag(app: App, storage: TagStorage, tag?: string): void {
  if (tag === undefined) new PickTagModal(app, storage).open();
  else new RenameTagModal(app, storage, tag).open();
}

/** Picks from existing tags, without "Create"; rows go up to Obsidian's `limit`, as in the tag dialog. */
class PickTagModal extends SuggestModal<TagSuggestion> {
  readonly #storage: TagStorage;
  readonly #all: TagCount[];

  constructor(app: App, storage: TagStorage) {
    super(app);
    this.#storage = storage;
    this.#all = listedTags(app, storage);
    this.setPlaceholder(t('renamePickPlaceholder'));
    this.emptyStateText = this.#all.length ? t('noSuchTag') : t('noTagsYet');
  }

  // The "Create" row of `suggestTags` takes one of the `limit` rows, so drop it before slicing or one tag is
  // lost.
  override getSuggestions(query: string): TagSuggestion[] {
    return suggestTags(query, this.#all, this.limit + 1)
      .filter((item) => !item.isNew)
      .slice(0, this.limit);
  }

  override renderSuggestion(item: TagSuggestion, el: HTMLElement): void {
    el.addClass('mod-complex');
    el.createDiv({ cls: 'suggestion-content' }).createDiv({ cls: 'suggestion-title', text: item.tag });
    el.createDiv({ cls: 'suggestion-aux' }).createSpan({ cls: 'suggestion-flair', text: String(item.count) });
  }

  override onChooseSuggestion(item: TagSuggestion): void {
    new RenameTagModal(this.app, this.#storage, item.tag).open();
  }
}

/**
 * Field with the new name, prefilled with the old; Enter or "Rename" makes the plan; a refusal shows a
 * notice.
 */
class RenameTagModal extends Modal {
  readonly #storage: TagStorage;
  readonly #from: string;
  #input: TextComponent | null = null;

  constructor(app: App, storage: TagStorage, from: string) {
    super(app);
    this.#storage = storage;
    this.#from = from;
  }

  override onOpen(): void {
    this.setTitle(t('renameTag'));
    new Setting(this.contentEl).setName(t('newName')).addText((text) => {
      this.#input = text.setValue(this.#from);
    });
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText(t('rename'))
        .setCta()
        .onClick(() => this.#submit()),
    );
    this.scope.register([], 'Enter', (evt) => {
      if (evt.isComposing) return;
      this.#submit();
      return false;
    });
    this.#input?.inputEl.select();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  #submit(): void {
    const plan = planRename(this.#from, this.#input?.getValue() ?? '', this.#storage.allTags());
    if (plan.kind === 'refuse') {
      new Notice(plan.reason);
      return;
    }
    this.close();
    if (plan.kind === 'merge')
      new MergeTagModal(
        this.app,
        this.#storage,
        this.#from,
        plan.to,
        listedFiles(this.app, this.#storage, plan.to),
      ).open();
    else void rename(this.app, this.#storage, this.#from, plan.to);
  }
}

/**
 * Confirms a merge with an existing tag, "Merge" or "Cancel", as a confirmation dialog like the tag menu's
 * `ConfirmModal` (group-modals.ts): `mod-confirmation` on the dialog and `mod-cancel` on "Cancel"; a bottom
 * sheet on iPhone; buttons as a row in `modalEl`, the same way.
 */
class MergeTagModal extends Modal {
  readonly #storage: TagStorage;
  readonly #from: string;
  readonly #to: string;
  readonly #files: number;
  #buttons: HTMLElement | null = null;

  constructor(app: App, storage: TagStorage, from: string, to: string, files: number) {
    super(app);
    this.#storage = storage;
    this.#from = from;
    this.#to = to;
    this.#files = files;
    this.containerEl.addClass('mod-confirmation');
  }

  override onOpen(): void {
    const n = this.#files;
    this.setTitle(t('mergeTags'));
    const names = { to: this.#to, from: this.#from };
    const text = n ? t('mergeTagHasFiles', { ...names, count: n }) : t('mergeTagNoFiles', names);
    this.contentEl.createEl('p', { text });
    const buttons = (this.#buttons = this.modalEl.createDiv({ cls: 'modal-button-container' }));
    new ButtonComponent(buttons)
      .setButtonText(t('merge'))
      .setCta()
      .onClick(() => {
        this.close();
        void rename(this.app, this.#storage, this.#from, this.#to);
      });
    new ButtonComponent(buttons)
      .setButtonText(t('cancel'))
      .setClass('mod-cancel')
      .onClick(() => this.close());
  }

  override onClose(): void {
    this.contentEl.empty();
    this.#buttons?.remove();
    this.#buttons = null;
  }
}

/**
 * Renames on all files and reports the result in a notice; a write failure shows a notice with details in the
 * console. The file count comes from the "All tags" list before the write, as in the merge dialog: records of
 * deleted files do not count.
 */
async function rename(app: App, storage: TagStorage, from: string, to: string): Promise<void> {
  const n = listedFiles(app, storage, from);
  try {
    await renameTag(storage, from, to);
  } catch (error) {
    console.error('Buba: tag not renamed', error);
    new Notice(t('renameFailed', { tag: from }));
    return;
  }
  new Notice(t('renamedTag', { from, to, count: n }));
}
