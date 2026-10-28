// Buba tree commands: create a folder, color and icon of the folder open in the active grid, reveal it in the
// tree, collapse and expand all, folder order. They are the tree's menu items and buttons as commands, like
// Obsidian's "Create new folder" and "Reveal current file in navigation", and go the same way as the items:
// the new folder name dialog (`newFolder`), the color and icon windows (folder-menu.ts), and the tree view's
// public `setOrder`, `collapseAll`, `expandAll` and `reveal`. Tree commands act on all open Buba trees; "the
// open folder" is the active grid's folder, not the root, "All files" or a module source. Only "Reveal open
// folder in tree" has a default key (src/core/settings/hotkeys.ts).
import { ItemView, type IconName, type Plugin, type TFolder, type View } from 'obsidian';
import { newFolderParent, ROOT, type NewFolderPlace } from '../../core/actions/new-folder.ts';
import { t } from '../../core/i18n/dict/tree.ts';
import { normalizeGridViewState } from '../../core/layout/view-state.ts';
import { hotkeysOf } from '../../core/settings/hotkeys.ts';
import type { BubaAssets } from '../api.ts';
import { pickColor, pickIcon, type FolderLookStorage } from './folder-menu.ts';
import { FOLDER_ORDERS, type FolderOrder } from './model.ts';
import { newFolder, TREE_VIEW_TYPE, TreeView } from './view.ts';

/** Order names, as in the tree's order menu. */
const ORDER_NAMES = {
  alphabetical: ['tree-order-alphabetical', 'commandOrderAlphabetical'],
  alphabeticalReverse: ['tree-order-alphabetical-reverse', 'commandOrderAlphabeticalReverse'],
  byModifiedTime: ['tree-order-modified', 'commandOrderModified'],
  byModifiedTimeReverse: ['tree-order-modified-reverse', 'commandOrderModifiedReverse'],
  byCreatedTime: ['tree-order-created', 'commandOrderCreated'],
  byCreatedTimeReverse: ['tree-order-created-reverse', 'commandOrderCreatedReverse'],
} as const satisfies Readonly<Record<FolderOrder, readonly [id: string, name: string]>>;

const NEW_FOLDER = [
  ['new-subfolder', 'commandNewSubfolder', 'inside'],
  ['new-folder-beside', 'commandNewFolderBeside', 'beside'],
] as const satisfies readonly (readonly [id: string, name: string, place: NewFolderPlace])[];

export function registerTreeCommands(plugin: Plugin, assets: BubaAssets): void {
  const { workspace, vault } = plugin.app;
  const trees = (): TreeView[] =>
    workspace
      .getLeavesOfType(TREE_VIEW_TYPE)
      .flatMap((leaf) => (leaf.view instanceof TreeView ? [leaf.view] : []));
  /** Folder of the active grid: the root, "All files" and a module source are not tree folders. */
  const openFolder = (): TFolder | null => {
    const active: unknown = workspace.getActiveViewOfType(ItemView);
    const grid = assets.gridViews().find((view) => (view as unknown) === active);
    if (!grid) return null;
    const { folder, source } = normalizeGridViewState((grid as unknown as View).getState());
    return folder === null || folder === ROOT || source ? null : vault.getFolderByPath(folder);
  };
  const storage = () => (plugin as Plugin & { storage?: FolderLookStorage }).storage;
  const add = (id: string, name: string, check: () => (() => void) | null, icon?: IconName): void => {
    const hotkeys = hotkeysOf(id);
    plugin.addCommand({
      id,
      name,
      ...(icon ? { icon } : {}),
      ...(hotkeys ? { hotkeys } : {}),
      checkCallback: (checking) => {
        const run = check();
        if (!run) return false;
        if (!checking) run();
        return true;
      },
    });
  };
  /** Acts on all open trees; without trees the command is unavailable. */
  const onTrees = (act: (tree: TreeView) => void) => () => {
    const list = trees();
    return list.length ? () => list.forEach(act) : null;
  };

  add('new-folder', t('commandNewFolder'), () => () => newFolder(plugin, ROOT), 'folder-plus');
  for (const [id, name, place] of NEW_FOLDER)
    add(
      id,
      t(name),
      () => {
        const folder = openFolder();
        return folder ? () => newFolder(plugin, newFolderParent(folder.path, place)) : null;
      },
      'folder-plus',
    );
  add('folder-color', t('commandFolderColor'), () => {
    const folder = openFolder();
    const looks = storage();
    return folder && looks ? () => pickColor(plugin.app, looks, folder) : null;
  });
  add('folder-icon', t('commandFolderIcon'), () => {
    const folder = openFolder();
    const looks = storage();
    return folder && looks ? () => pickIcon(plugin.app, looks, folder) : null;
  });
  add('reveal-folder', t('commandRevealFolder'), () => {
    const folder = openFolder();
    if (!folder) return null;
    return () =>
      void workspace.ensureSideLeaf(TREE_VIEW_TYPE, 'left', { reveal: true }).then(() => {
        for (const tree of trees()) tree.reveal(folder.path);
      });
  });
  add(
    'tree-collapse-all',
    t('commandCollapseAll'),
    onTrees((tree) => tree.collapseAll()),
    'chevrons-down-up',
  );
  add(
    'tree-expand-all',
    t('commandExpandAll'),
    onTrees((tree) => tree.expandAll()),
    'chevrons-up-down',
  );
  for (const order of FOLDER_ORDERS) {
    const [id, name] = ORDER_NAMES[order];
    add(
      id,
      t(name),
      onTrees((tree) => tree.setOrder(order)),
    );
  }
}
