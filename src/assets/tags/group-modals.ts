// Dialogs of the "All tags" menu: confirmation, a name (new group name or new tag name), and picking a group
// for a tag. Obsidian's `Modal` and `SuggestModal` (https://docs.obsidian.md/Plugins/User+interface/Modals),
// like the tag rename dialogs (rename.ts): the field is a `Setting` with a `TextComponent`, Enter does what
// the button does. Group and tag names are rendered as text only.
import { ButtonComponent, Modal, Setting, SuggestModal, type App, type TextComponent } from 'obsidian';
import { t } from '../../core/i18n/dict/tags.ts';
import { groupChoices, type GroupChoice, type GroupInfo } from '../../core/tags/group-plan.ts';

/**
 * Confirmation: lines of text, an action button and "Cancel"; closing without a choice does nothing.
 * `warning` marks an irreversible action, like Obsidian's delete dialog: "Cancel" first, the action as a red
 * button (`setWarning`, as in "Delete files" in src/assets/actions/menu-items.ts; `setDestructive` needs
 * Obsidian 1.13 and the plugin supports 1.12.3). It mimics Obsidian's confirmation dialog: `mod-confirmation`
 * on `containerEl` and `mod-cancel` on "Cancel", as `ConfirmationModal` and `setCancel` set them (both 1.13+
 * only). On iPhone these make the dialog a bottom sheet without the close button and with "Cancel" at the
 * bottom (Obsidian's app.css, `.is-mobile` and `.is-phone` rules); on desktop these classes have no rules.
 * Buttons are a row in `modalEl` after `contentEl`, as in `ConfirmationModal` and the "What Obsidian needs"
 * dialog (src/assets/settings/setup-window.ts): full width on phones; the row is removed on close.
 */
export class ConfirmModal extends Modal {
  readonly #title: string;
  readonly #lines: readonly string[];
  readonly #action: string;
  readonly #run: () => void;
  readonly #warning: boolean;
  #buttons: HTMLElement | null = null;

  constructor(
    app: App,
    title: string,
    lines: readonly string[],
    action: string,
    run: () => void,
    warning = false,
  ) {
    super(app);
    this.#title = title;
    this.#lines = lines;
    this.#action = action;
    this.#run = run;
    this.#warning = warning;
    this.containerEl.addClass('mod-confirmation');
  }

  override onOpen(): void {
    this.setTitle(this.#title);
    for (const line of this.#lines) this.contentEl.createEl('p', { text: line });
    const buttons = (this.#buttons = this.modalEl.createDiv({ cls: 'modal-button-container' }));
    const cancel = () =>
      new ButtonComponent(buttons)
        .setButtonText(t('cancel'))
        .setClass('mod-cancel')
        .onClick(() => this.close());
    if (this.#warning) cancel();
    const action = new ButtonComponent(buttons).setButtonText(this.#action).onClick(() => {
      this.close();
      this.#run();
    });
    if (this.#warning) action.setWarning();
    else {
      action.setCta();
      cancel();
    }
  }

  override onClose(): void {
    this.contentEl.empty();
    this.#buttons?.remove();
    this.#buttons = null;
  }
}

/**
 * A name field and a button; Enter or the button calls `submit` with the text. If `submit` returns `false`
 * the dialog stays open: it has already shown the refusal as a notice, as the tag rename dialog does. `label`
 * is the field label.
 */
export class NameModal extends Modal {
  readonly #title: string;
  readonly #value: string;
  readonly #button: string;
  readonly #submit: (text: string) => boolean;
  readonly #label: string;
  #input: TextComponent | null = null;

  constructor(
    app: App,
    title: string,
    value: string,
    button: string,
    submit: (text: string) => boolean,
    label = t('newName'),
  ) {
    super(app);
    this.#title = title;
    this.#value = value;
    this.#button = button;
    this.#submit = submit;
    this.#label = label;
  }

  override onOpen(): void {
    this.setTitle(this.#title);
    new Setting(this.contentEl).setName(this.#label).addText((text) => {
      this.#input = text.setValue(this.#value);
    });
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText(this.#button)
        .setCta()
        .onClick(() => this.#done()),
    );
    this.scope.register([], 'Enter', (evt) => {
      if (evt.isComposing) return;
      this.#done();
      return false;
    });
    this.#input?.inputEl.select();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  #done(): void {
    if (this.#submit(this.#input?.getValue() ?? '')) this.close();
  }
}

/** Picks a group for a tag: existing groups with tag counts, plus "New group "…"" from the typed text. */
export class GroupPickModal extends SuggestModal<GroupChoice> {
  readonly #groups: readonly GroupInfo[];
  readonly #current: string | null;
  readonly #choose: (group: string) => void;

  constructor(
    app: App,
    groups: readonly GroupInfo[],
    current: string | null,
    choose: (group: string) => void,
  ) {
    super(app);
    this.#groups = groups;
    this.#current = current;
    this.#choose = choose;
    this.setPlaceholder(t('groupPickPlaceholder'));
    this.emptyStateText = t('groupPickEmpty');
  }

  override getSuggestions(query: string): GroupChoice[] {
    return groupChoices(query, this.#groups, this.#current);
  }

  override renderSuggestion(item: GroupChoice, el: HTMLElement): void {
    el.addClass('mod-complex');
    const title = el.createDiv({ cls: 'suggestion-content' }).createDiv({ cls: 'suggestion-title' });
    if (item.isNew) {
      title.setText(t('newGroupChoice', { group: item.name }));
      return;
    }
    title.setText(item.name);
    el.createDiv({ cls: 'suggestion-aux' }).createSpan({ cls: 'suggestion-flair', text: String(item.tags) });
  }

  override onChooseSuggestion(item: GroupChoice): void {
    this.#choose(item.name);
  }
}
