// A prompt, negative prompt or lyrics in a window: the whole text, selectable and scrolled, its length and a
// copy button. Text only: the prompt is never read as HTML or Markdown.
import { Modal, type App } from 'obsidian';
import { t } from '../core/i18n/dict/generation.ts';
import { copy } from './thumbs.ts';

export class PromptModal extends Modal {
  readonly #title: string;
  readonly #text: string;
  readonly #copied: string;

  constructor(app: App, title: string, text: string, copied: string) {
    super(app);
    this.#title = title;
    this.#text = text;
    this.#copied = copied;
  }

  override onOpen(): void {
    this.modalEl.addClass('buba-gen-prompt-modal');
    this.setTitle(this.#title);
    this.contentEl.createDiv({ cls: 'buba-gen-prompt-full', text: this.#text });
    const footer = this.contentEl.createDiv({ cls: 'modal-button-container' });
    footer.createSpan({
      cls: 'buba-gen-prompt-count',
      text: t('charCount', { count: [...this.#text].length }),
    });
    footer
      .createEl('button', { cls: 'mod-cta', text: t('copy') })
      .addEventListener('click', () => void copy(this.#text, this.#copied));
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
