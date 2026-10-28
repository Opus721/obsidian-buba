// "Go to font installation" in the tile menu and the command of the same name: only when every selected file
// is a font (.ttf, .otf, .ttc), in the desktop app on Windows or macOS, and when tiles can be dragged out. It
// opens the system's font window (src/platform/fonts.ts) and, in the middle of Obsidian, a hint: hold Ctrl
// (Option on a Mac) and drag the fonts into that window. The system installs them, any number at once. The
// item sits in the `buba-file` section through `buba:tile-menu`, after "Make a copy" and "Open in default
// app", with the "Buba" label.
import {
  ButtonComponent,
  ItemView,
  Modal,
  Notice,
  TFile,
  type App,
  type Events,
  type Menu,
  type Plugin,
} from 'obsidian';
import { fontHint, isFontExtension, type FontSystem } from '../../core/actions/font-install.ts';
import { t } from '../../core/i18n/dict/actions.ts';
import { dragOutAvailable } from '../../platform/drag-out.ts';
import { fontSystem, openFontWindow } from '../../platform/fonts.ts';
import { ownTitle } from '../../platform/menu-title.ts';
import type { BubaAssets } from '../api.ts';
import { TILE_MENU } from './file-menu.ts';

export function registerFontInstall(plugin: Plugin, assets: BubaAssets): void {
  const { app } = plugin;
  plugin.registerEvent(
    (app.workspace as Events).on(TILE_MENU, (...data: unknown[]) => {
      const [menu, files] = data as [Menu, unknown];
      if (!Array.isArray(files)) return;
      const system = installSystem(files);
      if (system) addInstallItem(app, menu, system);
    }),
  );
  plugin.addCommand({
    id: 'install-fonts',
    name: t('commandInstallFonts'),
    icon: 'type',
    checkCallback: (checking) => {
      const active: unknown = app.workspace.getActiveViewOfType(ItemView);
      const view = assets.gridViews().find((each) => (each as unknown) === active);
      const files = (view?.selectedPaths?.() ?? []).map((path) => app.vault.getAbstractFileByPath(path));
      const system = installSystem(files);
      if (!system) return false;
      if (!checking) void goToInstall(app, system);
      return true;
    },
  });
}

/** The system to install on when all the files are fonts and they can be dragged out; otherwise `null`. */
function installSystem(files: readonly unknown[]): FontSystem | null {
  if (!files.length || !dragOutAvailable()) return null;
  const fonts = files.filter((file) => file instanceof TFile && isFontExtension(file.extension));
  return fonts.length === files.length ? fontSystem() : null;
}

function addInstallItem(app: App, menu: Menu, system: FontSystem): void {
  menu.addItem((item) =>
    item
      .setTitle(ownTitle(t('goToFontInstall')))
      .setIcon('type')
      .setSection('buba-file')
      .onClick(() => void goToInstall(app, system)),
  );
}

/** Opens the system's font window and the hint; a notice when the window did not open. */
async function goToInstall(app: App, system: FontSystem): Promise<void> {
  if (await openFontWindow(system)) new FontHintModal(app, system).open();
  else new Notice(t('fontWindowFailed'));
}

/**
 * The hint in the middle of the window, not a corner notice that is easy to miss. It closes on "Got it",
 * Escape or a click outside; the grid selection stays, so the fonts can be dragged right away.
 */
class FontHintModal extends Modal {
  readonly #system: FontSystem;

  constructor(app: App, system: FontSystem) {
    super(app);
    this.#system = system;
  }

  override onOpen(): void {
    this.setTitle(t('fontHintTitle'));
    this.contentEl.createEl('p', { text: fontHint(this.#system) });
    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    new ButtonComponent(buttons)
      .setButtonText(t('fontHintOk'))
      .setCta()
      .onClick(() => this.close());
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
