// "Copy path" as a command: copies the full disk path of exactly one selected file in the active grid
// (`diskPath`; the vault path on a phone), with the same `copyPath` as the button next to the path in the "File"
// section. The hotkey is in
// src/core/settings/hotkeys.ts.
import { ItemView, type Plugin } from 'obsidian';
import { t } from '../../core/i18n/dict/inspector.ts';
import { hotkeysOf } from '../../core/settings/hotkeys.ts';
import { diskPath } from '../../platform/disk-path.ts';
import type { BubaAssets } from '../api.ts';
import { copyPath } from './path-copy.ts';

export function registerInspectorCommands(plugin: Plugin, assets: BubaAssets): void {
  const { app } = plugin;
  const hotkeys = hotkeysOf('copy-file-path');
  plugin.addCommand({
    id: 'copy-file-path',
    name: t('commandCopyPath'),
    icon: 'copy',
    ...(hotkeys ? { hotkeys } : {}),
    checkCallback: (checking) => {
      const active: unknown = app.workspace.getActiveViewOfType(ItemView);
      const view = assets.gridViews().find((each) => (each as unknown) === active);
      const paths = view?.selectedPaths?.() ?? [];
      const path = paths.length === 1 ? paths[0] : undefined;
      if (path === undefined || app.vault.getFileByPath(path) === null) return false;
      if (!checking) void copyPath(diskPath(app, path));
      return true;
    },
  });
}
