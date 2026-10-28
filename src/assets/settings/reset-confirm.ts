// Asks before "Reset" puts Buba settings back (all of them, or only "Appearance"), since a reset cannot be undone. The dialog is a `Modal`
// like Obsidian's own confirmation: buttons in a row in `modalEl`, the red one first, Cancel `mod-cancel`.
import { ButtonComponent, Modal, type App } from 'obsidian';
import { t } from '../../core/i18n/dict/settings.ts';

/** What is reset: the whole page or only "Appearance"; the title and text follow. */
export type ResetScope = 'all' | 'look';

const TEXT = {
  all: { title: 'resetConfirmTitle', body: 'resetConfirmBody' },
  look: { title: 'resetLookConfirmTitle', body: 'resetLookConfirmBody' },
} as const;

/** Asks whether to reset: "Reset" gives `true`; Cancel, the close button and Esc give `false`. */
export function confirmReset(app: App, scope: ResetScope = 'all'): Promise<boolean> {
  return new Promise((done) => new ConfirmResetModal(app, scope, done).open());
}

class ConfirmResetModal extends Modal {
  readonly #scope: ResetScope;
  readonly #done: (reset: boolean) => void;
  #reset = false;
  #buttons: HTMLElement | null = null;

  constructor(app: App, scope: ResetScope, done: (reset: boolean) => void) {
    super(app);
    this.#scope = scope;
    this.#done = done;
  }

  override onOpen(): void {
    this.setTitle(t(TEXT[this.#scope].title));
    this.contentEl.createEl('p', { text: t(TEXT[this.#scope].body) });
    const buttons = (this.#buttons = this.modalEl.createDiv({ cls: 'modal-button-container' }));
    new ButtonComponent(buttons)
      .setButtonText(t('reset'))
      .setDestructive()
      .onClick(() => {
        this.#reset = true;
        this.close();
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
    this.#done(this.#reset);
  }
}
