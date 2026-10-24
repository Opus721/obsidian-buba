// Confirms a large batch of cards before dropping them on a canvas, like Chromium asks "Open all N tabs?"
// before opening many bookmarks. The dialog is a `Modal`; buttons sit in a row in `modalEl` and Cancel is
// `mod-cancel`, as in Obsidian's own confirmation dialog. Focus stays on the confirm button: the dialog
// answers a drop the user has just made, like Obsidian's "Delete file".
import { ButtonComponent, Modal, type App } from 'obsidian';
import { t } from '../core/i18n/dict/canvas.ts';

/** Asks whether to add `count` cards: confirm gives `true`; Cancel, the close button and Esc give `false`. */
export function confirmCards(app: App, count: number): Promise<boolean> {
  return new Promise((done) => new ConfirmCardsModal(app, count, done).open());
}

class ConfirmCardsModal extends Modal {
  readonly #count: number;
  readonly #done: (put: boolean) => void;
  #put = false;
  #buttons: HTMLElement | null = null;

  constructor(app: App, count: number, done: (put: boolean) => void) {
    super(app);
    this.#count = count;
    this.#done = done;
  }

  override onOpen(): void {
    this.setTitle(t('confirmTitle'));
    this.contentEl.createEl('p', { text: t('confirmBody', { count: this.#count }) });
    const buttons = (this.#buttons = this.modalEl.createDiv({ cls: 'modal-button-container' }));
    new ButtonComponent(buttons)
      .setButtonText(t('confirmButton'))
      .setCta()
      .onClick(() => {
        this.#put = true;
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
    this.#done(this.#put);
  }
}
