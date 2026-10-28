// Breadcrumbs above a note, canvas, base, PDF or picture that Obsidian opens itself: a click on a folder opens
// that folder in the Buba grid instead of revealing it in the file explorer. The grid takes the same tab, so
// the tab's back arrow returns to the file, as a click on a tile opened it there; Ctrl (Cmd) and the middle
// button open a new tab, Ctrl+Alt a tab to the right, as Obsidian's links.
// Buba's own path above the grid (`.buba-grid-path`) keeps its handler. Listened in the capture phase on every
// window, before Obsidian's own handler on the crumb.
import { FileView, Keymap, type Plugin, type WorkspaceLeaf } from 'obsidian';
import { GRID_VIEW_TYPE, nextGridState } from '../../core/layout/view-state.ts';
import type { BubaAssets } from '../api.ts';
import { crumbFolder } from '../grid/navigation.ts';

const CRUMB = '.view-header-breadcrumb';

export function registerBreadcrumbs(plugin: Plugin, _assets: BubaAssets): void {
  const { workspace } = plugin.app;
  const leafOf = (el: Element): WorkspaceLeaf | null => {
    let found: WorkspaceLeaf | null = null;
    workspace.iterateAllLeaves((leaf) => {
      if (!found && leaf.view.containerEl.contains(el)) found = leaf;
    });
    return found;
  };
  /** The leaf and folder of a crumb Buba takes under the event; `null` — Obsidian's own. */
  const crumbAt = (evt: MouseEvent): { leaf: WorkspaceLeaf; folder: string } | null => {
    if (!(evt.target instanceof Element)) return null;
    const crumb = evt.target.closest(CRUMB);
    if (!crumb || crumb.closest('.buba-grid-path')) return null;
    const leaf = leafOf(crumb);
    const view = leaf?.view;
    if (!leaf || !(view instanceof FileView) || !view.file || view.getViewType() === GRID_VIEW_TYPE)
      return null;
    const all = Array.from(crumb.parentElement?.querySelectorAll(CRUMB) ?? []);
    const folder = crumbFolder(view.file.path, all.indexOf(crumb), all.length);
    return folder === undefined ? null : { leaf, folder };
  };
  // The middle button press is cancelled, or Windows starts middle-button autoscroll and no `auxclick` follows.
  const onDown = (evt: MouseEvent): void => {
    if (evt.button === 1 && crumbAt(evt)) evt.preventDefault();
  };
  const onClick = (evt: MouseEvent): void => {
    const middle = evt.type === 'auxclick';
    if (evt.button !== (middle ? 1 : 0)) return;
    const hit = crumbAt(evt);
    if (!hit) return;
    const { leaf, folder } = hit;
    evt.preventDefault();
    evt.stopImmediatePropagation();
    const pane = middle ? 'tab' : Keymap.isModEvent(evt);
    const target = pane ? workspace.getLeaf(pane) : leaf;
    void target.setViewState({
      type: GRID_VIEW_TYPE,
      state: { ...nextGridState({}, { folder }) },
      active: true,
    });
  };
  const attached = new Set<Document>();
  const attach = (doc: Document): void => {
    if (attached.has(doc)) return;
    attached.add(doc);
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('auxclick', onClick, true);
    doc.addEventListener('mousedown', onDown, true);
  };
  attach(document);
  workspace.iterateAllLeaves((leaf) => attach(leaf.view.containerEl.doc));
  plugin.registerEvent(workspace.on('window-open', (win) => attach(win.doc)));
  plugin.registerEvent(
    workspace.on('window-close', (win) => {
      win.doc.removeEventListener('click', onClick, true);
      win.doc.removeEventListener('auxclick', onClick, true);
      win.doc.removeEventListener('mousedown', onDown, true);
      attached.delete(win.doc);
    }),
  );
  plugin.register(() => {
    for (const doc of attached) {
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('auxclick', onClick, true);
      doc.removeEventListener('mousedown', onDown, true);
    }
    attached.clear();
  });
}
