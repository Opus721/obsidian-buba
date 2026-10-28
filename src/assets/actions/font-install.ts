// "Install font" in the tile menu and the "Install selected fonts" command, like "Install" in Windows
// Explorer: one font or several selected at once, only when every selected file is a font (.ttf, .otf,
// .ttc) and only in the desktop app. The item sits in the `buba-file` section through `buba:tile-menu`,
// after "Make a copy" and "Open in default app", with the "Buba" label. Each file is read and checked in
// core (its sfnt signature and its name, src/core/actions/font-install.ts) before the system gets it; how
// the system installs it: src/platform/fonts.ts. The result is one notice: the font's name for one file,
// counts for several (`fontReport`).
import { ItemView, Notice, TFile, type Events, type Menu, type Plugin } from 'obsidian';
import {
  FONT_MAX_BYTES,
  fontPlan,
  fontReport,
  isFontExtension,
  type FontResult,
} from '../../core/actions/font-install.ts';
import { t } from '../../core/i18n/dict/actions.ts';
import { diskPath } from '../../platform/disk-path.ts';
import { fontInstallAvailable, installFontFiles, type FontJob } from '../../platform/fonts.ts';
import { ownTitle } from '../../platform/menu-title.ts';
import type { BubaAssets } from '../api.ts';
import { TILE_MENU } from './file-menu.ts';

export function registerFontInstall(plugin: Plugin, assets: BubaAssets): void {
  const { app } = plugin;
  plugin.registerEvent(
    (app.workspace as Events).on(TILE_MENU, (...data: unknown[]) => {
      const [menu, files] = data as [Menu, unknown];
      if (!Array.isArray(files)) return;
      const fonts = fontsOf(files);
      if (fonts) addInstallItem(plugin, menu, fonts);
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
      const fonts = fontsOf(files);
      if (!fonts) return false;
      if (!checking) void installFonts(plugin, fonts);
      return true;
    },
  });
}

/** The files when all of them are fonts and this device can install them; otherwise `null`. */
function fontsOf(files: readonly unknown[]): TFile[] | null {
  if (!files.length || !fontInstallAvailable()) return null;
  const fonts = files.filter(
    (file): file is TFile => file instanceof TFile && isFontExtension(file.extension),
  );
  return fonts.length === files.length ? fonts : null;
}

function addInstallItem(plugin: Plugin, menu: Menu, fonts: readonly TFile[]): void {
  const title = fonts.length === 1 ? t('installFont') : t('installFonts', { count: fonts.length });
  menu.addItem((item) =>
    item
      .setTitle(ownTitle(title))
      .setIcon('type')
      .setSection('buba-file')
      .onClick(() => void installFonts(plugin, fonts)),
  );
}

/** Reads and checks each file, installs the fonts in one batch, reports in one notice. */
/** A full disk path: `C:\…`, `C:/…`, `\\server\…` or `/…`. */
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

export async function installFonts(plugin: Plugin, files: readonly TFile[]): Promise<void> {
  const { app } = plugin;
  const progress = new Notice(t('fontsInstalling'), 0);
  const jobs: FontJob[] = [];
  const names: string[] = [];
  const outcomes: FontResult[] = [];
  /** Where each job's outcome goes in `outcomes`. */
  const slots: number[] = [];
  for (const file of files) {
    let plan = null;
    try {
      if (file.stat.size <= FONT_MAX_BYTES)
        plan = fontPlan(file.name, new Uint8Array(await app.vault.readBinary(file)));
    } catch (error) {
      console.error('Buba: font not read', file.path, error);
    }
    names.push(plan?.name ?? file.name);
    if (!plan) {
      outcomes.push('not-font');
      continue;
    }
    const from = diskPath(app, file.path);
    outcomes.push('failed');
    // Only a full disk path: `diskPath` falls back to the vault path, which PowerShell would read from its own
    // folder, another file than the one checked (review 28.10).
    if (!ABSOLUTE_PATH.test(from)) {
      console.error('Buba: font has no disk path', file.path);
      continue;
    }
    slots.push(outcomes.length - 1);
    jobs.push({ from, file: file.name, name: plan.registryName });
  }
  const done = jobs.length ? await installFontFiles(jobs) : [];
  slots.forEach((slot, i) => (outcomes[slot] = done[i] ?? 'failed'));
  progress.hide();
  new Notice(fontReport(outcomes, names[0] ?? ''));
}
