// `buba:open path=<folder | board.canvas>`: shows a folder in the Buba grid in the main area, or a board in a
// tab. The result is checked on the leaf after the call (`src/core/cli/open.ts`): Obsidian also reports
// success for a call it skipped.
import type { Plugin, TFile, View, Workspace } from 'obsidian';
import { CliError } from '../core/cli/answer.ts';
import { checkPath } from '../core/cli/input.ts';
import { CANVAS_VIEW_TYPE, checkCanvasOpened, checkGridOpened } from '../core/cli/open.ts';
import { GRID_VIEW_TYPE, nextGridState } from '../core/layout/view-state.ts';
import { registerBubaCli } from '../platform/cli.ts';

export function registerOpen(plugin: Plugin): void {
  registerBubaCli(
    plugin,
    'open',
    'open a folder in the Buba grid or a .canvas board',
    { path: { value: '<folder | board.canvas>', description: 'folder or board path from the vault root' } },
    async (params) => {
      const path = checkPath(params.path);
      const { vault, workspace } = plugin.app;
      if (vault.getFolderByPath(path)) {
        await openFolder(workspace, path);
        return { opened: 'folder', path };
      }
      const file = vault.getFileByPath(path);
      if (!file) throw new CliError('not-found', path);
      if (file.extension !== 'canvas') throw new CliError('not-folder-or-canvas', path);
      await openCanvas(workspace, file);
      return { opened: 'canvas', path };
    },
  );
}

/**
 * Picks the grid leaf like the assets module's `openGrid`: the first open one, otherwise a new tab; the state
 * keeps the previous one with the requested folder (`nextGridState` drops a foreign source). This command
 * cannot use the `openGrid` queue because modules do not import each other.
 */
async function openFolder(workspace: Workspace, folder: string): Promise<void> {
  const leaf = workspace.getLeavesOfType(GRID_VIEW_TYPE)[0] ?? workspace.getLeaf('tab');
  const state = { ...nextGridState(leaf.getViewState().state, { folder }) };
  await leaf.setViewState({ type: GRID_VIEW_TYPE, state, active: true });
  await workspace.revealLeaf(leaf);
  checkGridOpened(folder, leaf.getViewState());
}

/**
 * A board already open in a leaf: show that leaf and make it active, because `revealLeaf` only selects the
 * tab and leaves the hidden leaf active (Obsidian 1.14.4). Otherwise a new tab: replacing the current one
 * would close what the user is reading. The leaf is found by the file in its state: a deferred leaf after
 * restart (`isDeferred`) has not built its view yet, and `revealLeaf` returns before the view gets the file,
 * so `loadIfDeferred` waits for it.
 */
async function openCanvas(workspace: Workspace, file: TFile): Promise<void> {
  let leaf = workspace
    .getLeavesOfType(CANVAS_VIEW_TYPE)
    .find((item) => item.getViewState().state?.file === file.path);
  if (leaf) {
    await leaf.loadIfDeferred();
    await workspace.revealLeaf(leaf);
    workspace.setActiveLeaf(leaf, { focus: true });
  } else {
    leaf = workspace.getLeaf('tab');
    await leaf.openFile(file, { active: true });
    await workspace.revealLeaf(leaf);
  }
  checkCanvasOpened(file.path, { type: leaf.view.getViewType(), file: fileOf(leaf.view) });
}

/** The view's file, like `FileView.file`; `null` for a view without a file. */
function fileOf(view: View): string | null {
  return (view as View & { file?: TFile | null }).file?.path ?? null;
}
