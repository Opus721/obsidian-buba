// Buba dialog before a batch move: while Obsidian's "Always update internal links" setting is off, Obsidian
// asks "Update links" for every file with links, and dismissing that dialog leaves the link broken. Buba asks
// once and on "Turn on" enables the setting itself, like Obsidian's "Always update" button, but before the
// batch rather than in the middle of it. The dialog is a `Modal`, as in src/assets/tags/rename.ts.
import { ButtonComponent, Modal, Notice, type App } from 'obsidian';
import { askLinkSetting, linkedCount } from '../../core/actions/links-setting.ts';
import { t } from '../../core/i18n/dict/actions.ts';
import {
  enableLinksAutoUpdate,
  linksAutoUpdate,
  linksSettingAnswered,
  saveLinksSettingAnswer,
  type LinksSettingAnswer,
} from '../../platform/files/links-setting.ts';

/**
 * Called before moving `paths`: `true` means move, `false` means the dialog was closed with the close button
 * or Esc and nothing moves. If there is no need to ask, `true` right away. "Turn on" and "Don't turn on" save
 * the answer and Buba never asks again; a dismissed dialog saves nothing, so Buba asks on the next move.
 */
export async function confirmLinkUpdates(app: App, paths: readonly string[]): Promise<boolean> {
  const linked = linkedCount(paths, app.metadataCache.resolvedLinks);
  const ask = askLinkSetting({
    autoUpdate: linksAutoUpdate(app),
    answered: linksSettingAnswered(app),
    linked,
  });
  if (!ask) return true;
  const answer = await new Promise<LinksSettingAnswer | null>((done) =>
    new LinksSettingModal(app, linked, done).open(),
  );
  if (answer === null) return false;
  if (answer === 'enable') {
    new Notice((await enableLinksAutoUpdate(app)) ? t('linksEnabled') : t('linksEnableFailed'));
  }
  saveLinksSettingAnswer(app, answer);
  return true;
}

/**
 * Shows the number of files with links, without names; "Turn on" is the main button, "Don't
 * turn on" the refusal (`mod-cancel`, as in Obsidian's confirmation dialog: at the bottom
 * on a phone). Resolves to the answer, `null` when dismissed. The dialog changes the user's
 * Obsidian setting, so no button has focus on open: Enter and space enable nothing until
 * the user clicks or tabs to a button, as in the "What Obsidian needs" window.
 */
class LinksSettingModal extends Modal {
  readonly #linked: number;
  readonly #done: (answer: LinksSettingAnswer | null) => void;
  #answer: LinksSettingAnswer | null = null;
  #buttons: HTMLElement | null = null;

  constructor(app: App, linked: number, done: (answer: LinksSettingAnswer | null) => void) {
    super(app);
    this.#linked = linked;
    this.#done = done;
  }

  // With a physical keyboard Obsidian 1.12–1.14 focuses the first button right after `onOpen`, in `open()`.
  override open(): void {
    super.open();
    const focused = this.modalEl.doc.activeElement as HTMLElement | SVGElement | null;
    if (focused && this.modalEl.contains(focused)) focused.blur();
  }

  override onOpen(): void {
    this.setTitle(t('linksTitle'));
    this.contentEl.createEl('p', {
      text: t('linksBody', { count: this.#linked }),
    });
    this.contentEl.createEl('p', { text: t('linksQuestion') });
    const buttons = (this.#buttons = this.modalEl.createDiv({ cls: 'modal-button-container' }));
    new ButtonComponent(buttons)
      .setButtonText(t('turnOn'))
      .setCta()
      .onClick(() => this.#choose('enable'));
    new ButtonComponent(buttons)
      .setButtonText(t('dontTurnOn'))
      .setClass('mod-cancel')
      .onClick(() => this.#choose('decline'));
  }

  override onClose(): void {
    this.contentEl.empty();
    this.#buttons?.remove();
    this.#buttons = null;
    this.#done(this.#answer);
  }

  #choose(answer: LinksSettingAnswer): void {
    this.#answer = answer;
    this.close();
  }
}
