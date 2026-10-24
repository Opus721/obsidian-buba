// Opening the viewer from the grid: double-click on a file tile, Space with focus in the grid body, and the
// "Quick look" command open the viewer (`openViewer`) with all grid files in display order; Space in the
// viewer closes it and focus returns to the grid body. Grid keys live in its view's `scope` (active only
// while the body has focus); the command has no default hotkey, users assign one in Obsidian settings. Arrows
// and Esc belong to the viewer itself. Double-click opens notes, canvases, bases, PDFs and audio in Obsidian
// itself, like its file explorer.
import { ItemView, Keymap, type KeymapEventHandler, type Modal, type Plugin, type Scope } from 'obsidian';
import { t } from '../../core/i18n/dict/viewer.ts';
import { settingsOf } from '../../platform/settings.ts';
import type { BubaAssets } from '../api.ts';
import { onGridEvent, type GridLeafView } from '../grid/selection.ts';
import { openViewer, opensInObsidian } from './viewer.ts';

/** Quick look key in `scope`: the `KeyboardEvent.key` of Space. */
const SPACE = ' ';

export function registerViewerOpen(plugin: Plugin, assets: BubaAssets): void {
  const { vault, workspace } = plugin.app;
  /** Viewer opened from here and not yet closed: a second one is not opened, the command closes it. */
  let current: Modal | null = null;

  const gridViews = (): GridLeafView[] =>
    assets.gridViews().filter((view): view is GridLeafView => view instanceof ItemView);
  const isFile = (path: string): boolean => vault.getFileByPath(path) !== null;
  /** First selected file in grid order; folders and an empty selection give nothing. */
  const firstSelectedFile = (view: GridLeafView): string | undefined => view.selectedPaths?.().find(isFile);

  /** Opens `path` with the grid's file list (folder tiles are not included). */
  const show = (view: GridLeafView, path: string): void => {
    if (current) return;
    const files = view.pathsInOrder().filter(isFile);
    const index = files.indexOf(path);
    if (index < 0) return;
    const modal = openViewer(plugin.app, files, index);
    current = modal;
    modal.scope.register([], SPACE, (evt) => {
      if (!evt.repeat) modal.close();
      return false;
    });
    modal.setCloseCallback(() => {
      if (current === modal) current = null;
      const body = view.containerEl.querySelector<HTMLElement>('.buba-grid-scroller');
      if (body?.isConnected) body.focus({ preventScroll: true });
    });
  };

  // Like Obsidian's file explorer: in the same tab as a history step ("back" returns to the grid), with Ctrl
  // (Cmd) in a new tab.
  onGridEvent(plugin, assets, 'dblclick', (evt, { view, path }) => {
    if (evt.button !== 0 || path === null) return;
    const file = vault.getFileByPath(path);
    if (file && opensInObsidian(file)) void workspace.getLeaf(Keymap.isModEvent(evt)).openFile(file);
    else show(view, path);
  });

  // Space goes on the grid view's `scope`; views appear after the plugin, so the key is bound on every layout
  // change. Cleanup is registered on the view too: an entry in `bound` kept until plugin unload would hold
  // every closed view. `(null, null)` as for T and 1–5: a handler bound to a key that returns `undefined`
  // still ends Obsidian's lookup, so a disabled Space would never reach the hotkeys. Ours is Space without
  // modifiers, by physical key or Obsidian's `vkey`; anything else, or keys turned off on Buba's settings
  // page, returns `undefined`.
  const bound = new Map<Scope, KeymapEventHandler>();
  const bind = (): void => {
    for (const view of gridViews()) {
      const { scope } = view;
      if (!scope || bound.has(scope)) continue;
      const handler = scope.register(null, null, (evt, ctx) => {
        if (evt.code !== 'Space' && ctx?.vkey !== SPACE) return undefined;
        if (evt.ctrlKey || evt.metaKey || evt.altKey || evt.shiftKey) return undefined;
        if (!settingsOf(plugin).gridKeys) return undefined;
        // A held key repeats, so the viewer does not flicker; without a selection Space does nothing.
        const path = evt.repeat ? undefined : firstSelectedFile(view);
        if (path !== undefined) show(view, path);
        return false;
      });
      bound.set(scope, handler);
      view.register(() => {
        scope.unregister(handler);
        bound.delete(scope);
      });
    }
  };
  workspace.onLayoutReady(bind);
  plugin.registerEvent(workspace.on('layout-change', bind));
  plugin.register(() => {
    for (const [scope, handler] of bound) scope.unregister(handler);
    bound.clear();
    current?.close();
  });

  plugin.addCommand({
    id: 'quick-look',
    name: t('commandQuickLook'),
    checkCallback(checking) {
      if (current) {
        if (!checking) current.close();
        return true;
      }
      const active = workspace.getActiveViewOfType(ItemView);
      const view = gridViews().find((each) => each === active);
      const path = view && firstSelectedFile(view);
      if (!view || path === undefined) return false;
      if (!checking) show(view, path);
      return true;
    },
  });
}
