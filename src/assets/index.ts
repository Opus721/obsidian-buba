// The "asset management" module: the Buba tree on the left, the grid view in the center, the "Open Buba" and
// "All files" commands, and "Open in Buba" in the folder menu. Other modules connect to the grid and the tree
// through `assets`, each with its own `register…` line below.
import { TFile, TFolder, type Events, type Plugin } from 'obsidian';
import { REVEAL_IN_TREE, SHOW_IN_FOLDER, VIEW_FILES } from '../core/inspector/events.ts';
import { nextGridState } from '../core/layout/view-state.ts';
import { t } from '../core/i18n/dict/platform.ts';
import { hotkeysOf } from '../core/settings/hotkeys.ts';
import { ownTitle } from '../platform/menu-title.ts';
import { previewStore } from '../platform/previews/store.ts';
import { registerActions } from './actions/index.ts';
import { createAssets, type GridStatePatch } from './api.ts';
import { registerCommands } from './commands.ts';
import { registerGridSources } from './grid/sources.ts';
import { registerSortKeys, registerTypeSort } from './grid/sort-keys.ts';
import { GRID_VIEW_TYPE, GridView } from './grid/view.ts';
import { registerMobile } from './mobile/index.ts';
import { registerSettings } from './settings/index.ts';
import { registerTags } from './tags/index.ts';
import { registerTree } from './tree/register.ts';
import { TREE_VIEW_TYPE, TreeView } from './tree/view.ts';
import { openViewer, opensInObsidian } from './viewer/viewer.ts';

export function registerAssets(plugin: Plugin): void {
  // The preview store starts at load, like Obsidian's metadata cache: entries follow renames and deletions
  // even before the grid or the file panel is opened. The call starts no builds and opens the database in the
  // background.
  previewStore(plugin);
  const assets = createAssets({
    gridViews: () =>
      plugin.app.workspace
        .getLeavesOfType(GRID_VIEW_TYPE)
        .map((leaf) => leaf.view)
        .filter((view) => view instanceof GridView),
    openGrid: (patch) => openGrid(plugin, patch),
  });
  plugin.registerView(TREE_VIEW_TYPE, (leaf) => new TreeView(leaf, plugin, assets));
  plugin.registerView(GRID_VIEW_TYPE, (leaf) => new GridView(leaf, plugin, assets));
  plugin.addCommand({
    id: 'open',
    name: t('commandOpen'),
    ...(hotkeysOf('open') ? { hotkeys: hotkeysOf('open') } : {}),
    callback: () => void openBuba(plugin),
  });
  plugin.addCommand({
    id: 'open-all-files',
    name: t('commandAllFiles'),
    callback: () => void openGrid(plugin, null),
  });
  plugin.registerEvent(
    plugin.app.workspace.on('file-menu', (menu, file, source) => {
      // Not in the Buba tree's own menu: a click there already opens the folder.
      if (!(file instanceof TFolder) || source === TREE_VIEW_TYPE) return;
      menu.addItem((item) =>
        item
          .setTitle(ownTitle(t('openInBuba')))
          .setIcon('bird')
          .onClick(() => void openGrid(plugin, file.path)),
      );
    }),
  );
  registerOpenEvents(plugin);
  registerTree(plugin, assets);
  registerGridSources(plugin, assets);
  registerSortKeys(plugin, assets);
  registerTags(plugin, assets);
  registerTypeSort(assets);
  registerActions(plugin, assets);
  registerMobile(plugin, assets);
  registerSettings(plugin);
  // Commands go last: by now every sort key is registered.
  registerCommands(plugin, assets);
}

/**
 * Files opened from another module (the generation section of the file panel): a file the way a grid tile
 * opens it, or shown in its folder in the grid, selected.
 */
function registerOpenEvents(plugin: Plugin): void {
  const { vault, workspace } = plugin.app;
  plugin.registerEvent(
    (workspace as Events).on(VIEW_FILES, (paths, index, newTab) => {
      if (!Array.isArray(paths) || typeof index !== 'number') return;
      const file = vault.getFileByPath(String(paths[index]));
      if (!file) return;
      if (newTab === true || opensInObsidian(file)) {
        void workspace.getLeaf(newTab === true ? 'tab' : false).openFile(file);
        return;
      }
      // The viewer pages through the files it shows; notes and audio among them open on their own.
      const files = paths
        .map((path) => vault.getFileByPath(String(path)))
        .filter((each): each is TFile => each !== null && !opensInObsidian(each));
      openViewer(
        plugin.app,
        files.map((each) => each.path),
        Math.max(0, files.indexOf(file)),
      );
    }),
  );
  plugin.registerEvent(
    (workspace as Events).on(SHOW_IN_FOLDER, (path) => {
      const file = typeof path === 'string' ? vault.getFileByPath(path) : null;
      if (file) void showInFolder(plugin, file);
    }),
  );
  plugin.registerEvent(
    (workspace as Events).on(REVEAL_IN_TREE, (path) => {
      const folder = typeof path === 'string' ? vault.getFileByPath(path)?.parent : null;
      if (!folder || folder.isRoot()) return;
      void workspace.ensureSideLeaf(TREE_VIEW_TYPE, 'left', { reveal: true }).then(() => {
        for (const leaf of workspace.getLeavesOfType(TREE_VIEW_TYPE))
          if (leaf.view instanceof TreeView) leaf.view.reveal(folder.path);
      });
    }),
  );
}

/** Opens the file's folder in the grid with the file selected, its row near the top. */
async function showInFolder(plugin: Plugin, file: TFile): Promise<void> {
  await openGrid(plugin, file.parent?.path ?? '/');
  const leaf = plugin.app.workspace.getLeavesOfType(GRID_VIEW_TYPE)[0];
  leaf?.setEphemeralState({
    place: { path: file.path, offset: 0 },
    selected: [file.path],
    anchor: file.path,
  });
}

let queue: Promise<void> = Promise.resolve();

/**
 * Finds the grid leaf, or opens one in a new tab, and applies part of its state; a string or `null` sets only
 * the folder: `null` is "All files", `'/'` the root. Calls run one at a time: Obsidian silently drops a
 * second `setViewState` on a leaf while the first is still running.
 */
export function openGrid(plugin: Plugin, target: string | null | GridStatePatch): Promise<void> {
  const patch = typeof target === 'string' || target === null ? { folder: target } : target;
  const run = async (): Promise<void> => {
    const { workspace } = plugin.app;
    const leaf = workspace.getLeavesOfType(GRID_VIEW_TYPE)[0] ?? workspace.getLeaf('tab');
    const state = { ...nextGridState(leaf.getViewState().state, patch) };
    await leaf.setViewState({ type: GRID_VIEW_TYPE, state, active: true });
    await workspace.revealLeaf(leaf);
  };
  queue = queue.then(run, run);
  return queue;
}

/** Buba tree in the left sidebar and the grid in the center; an open grid stays on its folder. */
async function openBuba(plugin: Plugin): Promise<void> {
  const { workspace } = plugin.app;
  await workspace.ensureSideLeaf(TREE_VIEW_TYPE, 'left', { reveal: true });
  const grid = workspace.getLeavesOfType(GRID_VIEW_TYPE)[0];
  if (grid) await workspace.revealLeaf(grid);
  else await openGrid(plugin, null);
}
