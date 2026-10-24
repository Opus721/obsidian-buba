// "What Obsidian needs" window: new recommendations at `onLayoutReady` (src/core/settings/setup.ts), shown
// again by a button in the Buba settings. Only the buttons record "shown": the close button, Esc and a tap
// outside record nothing. It is an Obsidian confirmation modal (`mod-confirmation`): at the bottom and
// without a close button on a phone, buttons in a row in `modalEl`, like Obsidian's confirmation dialogs. The
// window changes the user's Obsidian settings, so no button has focus on open, as in Obsidian's settings
// window: Enter and Space do nothing until the user clicks or tabs to a button.
import { ButtonComponent, Modal, Notice, type App, type Plugin } from 'obsidian';
import { t } from '../../core/i18n/dict/settings.ts';
import { enabling, setupPlan, type SetupItem } from '../../core/settings/setup.ts';
import { JOURNAL_DIR } from '../../core/storage/types.ts';
import { linksSettingAnswered, saveLinksSettingAnswer } from '../../platform/files/links-setting.ts';
import { coreFlag, enableCoreFlag, markShown, shownItems } from '../../platform/setup.ts';

/**
 * Items use Obsidian's own wording; the journal folder is substituted because folder names are not
 * translated.
 */
const TEXT: Record<SetupItem, () => string> = {
  alwaysUpdateLinks: () => t('setupLinks'),
  showUnsupportedFiles: () => t('setupShowAll', { folder: JOURNAL_DIR }),
  sync: () => t('setupSync', { folder: JOURNAL_DIR }),
};

const windows = new WeakMap<App, SetupModal>();

function showSetupWindow(app: App, items: SetupItem[]): void {
  windows.get(app)?.close();
  const modal = new SetupModal(app, items, () => windows.delete(app));
  windows.set(app, modal);
  modal.open();
}

/** Explicit re-check: the settings that are off now and the Sync reminder, regardless of earlier answers. */
export function openSetupWindow(app: App): void {
  showSetupWindow(
    app,
    setupPlan({
      shown: [],
      links: coreFlag(app, 'alwaysUpdateLinks'),
      linksAnswered: false,
      unsupported: coreFlag(app, 'showUnsupportedFiles'),
    }),
  );
}

export function registerSetupWindow(plugin: Plugin): void {
  const { app } = plugin;
  app.workspace.onLayoutReady(() => {
    const items = setupPlan({
      shown: shownItems(app),
      links: coreFlag(app, 'alwaysUpdateLinks'),
      linksAnswered: linksSettingAnswered(app),
      unsupported: coreFlag(app, 'showUnsupportedFiles'),
    });
    if (!items.length) return;
    showSetupWindow(app, items);
  });
  // The plugin was disabled while the window is open: it closes without an answer.
  plugin.register(() => windows.get(app)?.close());
}

type Answer = 'enable' | 'decline' | 'seen';

class SetupModal extends Modal {
  readonly #items: SetupItem[];
  readonly #closed: () => void;
  #answer: Answer | null = null;
  #buttons: HTMLElement | null = null;

  constructor(app: App, items: SetupItem[], closed: () => void) {
    super(app);
    this.#items = items;
    this.#closed = closed;
  }

  // With a physical keyboard Obsidian 1.12–1.14 focuses the first button right after `onOpen`, inside
  // `open()`.
  override open(): void {
    super.open();
    const focused = this.modalEl.doc.activeElement as HTMLElement | SVGElement | null;
    if (focused && this.modalEl.contains(focused)) focused.blur();
  }

  override onOpen(): void {
    this.containerEl.addClass('mod-confirmation');
    this.setTitle(t('groupObsidian'));
    // Items are paragraphs right in the content, like the text of Obsidian's confirmation dialogs, so the
    // text margins are the content margins on both sides. A bulleted list shifted the text by its own left
    // indent.
    for (const item of this.#items)
      this.contentEl.createEl('p', { cls: 'buba-setup-item', text: TEXT[item]() });
    this.contentEl.createEl('p', { text: t('setupLater') });
    const buttons = (this.#buttons = this.modalEl.createDiv({ cls: 'modal-button-container' }));
    if (enabling(this.#items).length) {
      new ButtonComponent(buttons)
        .setButtonText(t('enable'))
        .setCta()
        .onClick(() => this.#choose('enable'));
      new ButtonComponent(buttons)
        .setButtonText(t('setupDecline'))
        .setClass('mod-cancel')
        .onClick(() => this.#choose('decline'));
    } else {
      new ButtonComponent(buttons)
        .setButtonText(t('setupGotIt'))
        .setCta()
        .onClick(() => this.#choose('seen'));
    }
  }

  override onClose(): void {
    this.contentEl.empty();
    this.#buttons?.remove();
    this.#buttons = null;
    this.#closed();
  }

  async #choose(answer: Answer): Promise<void> {
    if (this.#answer) return;
    this.#answer = answer;
    const { app } = this;
    const items = this.#items;
    markShown(app, items);
    if (answer !== 'seen' && items.includes('alwaysUpdateLinks')) saveLinksSettingAnswer(app, answer);
    this.close();
    if (answer !== 'enable') return;
    // Read the value at "Enable" time: Sync may have brought app.json while the window was open; a flag that
    // is already on is not written.
    let failed = false;
    for (const key of enabling(items))
      if (coreFlag(app, key) !== true && !(await enableCoreFlag(app, key))) failed = true;
    new Notice(t(failed ? 'setupFailed' : 'setupDone'));
  }
}
