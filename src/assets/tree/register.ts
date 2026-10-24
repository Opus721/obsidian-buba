// Buba tree items: "All files" with the count of all indexed files; its menu (right-click, long press on a
// phone) has "New folder…" in the root, like "New tag…" on "All tags".
import type { Plugin } from 'obsidian';
import { ROOT } from '../../core/actions/new-folder.ts';
import { t } from '../../core/i18n/dict/tree.ts';
import { vaultFileIndex } from '../../platform/files/vault-index.ts';
import type { BubaAssets } from '../api.ts';
import { addNewFolderItem } from './create-folder.ts';
import { newFolder } from './view.ts';

export function registerTree(plugin: Plugin, assets: BubaAssets): void {
  const index = vaultFileIndex(plugin);
  assets.registerTreeItem({
    id: 'all',
    title: t('allFiles'),
    icon: 'files',
    source: { kind: 'all' },
    count: () => index.total(),
    onChange: (listener) => index.onChange(listener),
    menu: (menu) => addNewFolderItem(menu, () => newFolder(plugin, ROOT)),
  });
}
