// Buba tree items: "All files" with the count of all indexed files; its menu (right-click, long press on a
// phone) has "New folder…" in the root, like "New tag…" on "All tags". A folder dragged from the tree onto
// "All files" or the empty space below the folders goes to the vault root.
import type { Plugin } from 'obsidian';
import { ROOT } from '../../core/actions/new-folder.ts';
import { folderDrop } from '../../core/actions/tree-drop.ts';
import { endTreeRowDrag, treeRowDrag } from '../../platform/tree-drag.ts';
import { moveFolder } from '../actions/tree-drop.ts';
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
    drop: {
      space: true,
      accepts: (dt) => {
        const drag = treeRowDrag(dt);
        return drag?.kind === 'folder' && folderDrop(drag.path, ROOT) !== null;
      },
      drop: (dt) => {
        const drag = treeRowDrag(dt);
        endTreeRowDrag();
        if (drag?.kind === 'folder') void moveFolder(plugin.app, drag.path, ROOT);
      },
    },
  });
}
