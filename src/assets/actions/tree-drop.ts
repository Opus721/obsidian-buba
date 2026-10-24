// Tiles dropped on a folder in the Buba tree are moved into it as a batch: `moveFiles` writes the plan to the
// action log and calls `fileManager.renameFile`, so links in notes and canvas cards stay intact. Standard
// drag events on folder rows `[data-path]` are delegated on the document of every Obsidian window; the
// highlight is the `is-being-dragged-over` class the native file explorer uses for the folder under a drop,
// drawn by the theme. Only tiles from this vault are moved. Files from the file manager dropped on the same
// row are copied into the folder by the same write and report as a drop on the grid (`importInto`); the core
// rule `treeDrop` decides what to do with a drop. Other drags are left alone.
import { Notice, type App, type Plugin } from 'obsidian';
import { t } from '../../core/i18n/dict/actions.ts';
import { treeDrop, type TreeDropTarget } from '../../core/actions/tree-drop.ts';
import { hasBubaDragData, readBubaDragPaths } from '../../platform/canvas-drag.ts';
import { readDropped } from '../../platform/files/import.ts';
import { moveFiles } from '../../platform/files/move.ts';
import { recordMoves } from '../../platform/files/undo.ts';
import type { BubaAssets } from '../api.ts';
import { importInto } from './import-drop.ts';
import { confirmLinkUpdates } from './links-setting.ts';
import { moveNotice, registerResume } from './resume.ts';
import { isOwnTileDrag } from './tile-drag.ts';

const OVER = 'is-being-dragged-over';

type DragType = 'dragover' | 'dragleave' | 'dragend' | 'drop';

export function registerTreeDrop(plugin: Plugin, _assets: BubaAssets): void {
  const { app } = plugin;
  let lit: HTMLElement | null = null;
  const light = (row: HTMLElement | null): void => {
    if (lit === row) return;
    lit?.removeClass(OVER);
    lit = row;
    row?.addClass(OVER);
  };
  onDocuments(plugin, {
    dragover: (evt) => {
      const target = dropTarget(app, evt);
      light(target?.row ?? null);
      if (!target || !evt.dataTransfer) return;
      evt.preventDefault();
      evt.dataTransfer.dropEffect = target.action;
    },
    dragleave: (evt) => {
      if (lit && !lit.contains(evt.relatedTarget as Node | null)) light(null);
    },
    dragend: () => light(null),
    drop: (evt) => {
      light(null);
      const target = dropTarget(app, evt);
      const dt = evt.dataTransfer;
      if (!target || !dt) return;
      evt.preventDefault();
      // Drag data is readable only during `drop`, so it is read before the first `await`.
      if (target.action === 'copy') {
        void importInto(app, target.folder, readDropped(dt));
        return;
      }
      const paths = isOwnTileDrag(dt) ? (readBubaDragPaths(dt) ?? []) : null;
      void dropInto(app, target.folder, paths);
    },
  });
  registerResume(plugin);
}

/**
 * The folder row under the event point and what to do with the drop; `null` for no folder or a foreign drag.
 */
function dropTarget(app: App, evt: DragEvent): (TreeDropTarget & { row: HTMLElement }) | null {
  const dt = evt.dataTransfer;
  if (!dt) return null;
  const row = folderRow(app, evt.target);
  const target = treeDrop(
    { buba: hasBubaDragData(dt), files: dt.types.includes('Files') },
    row?.dataset.path ?? null,
  );
  return target && row ? { ...target, row } : null;
}

/** The Buba tree folder row under the event point; a row whose path is not a folder is not a target. */
function folderRow(app: App, target: EventTarget | null): HTMLElement | null {
  const el = target as Element | null;
  if (typeof el?.closest !== 'function') return null;
  const row = el.closest<HTMLElement>('.buba-tree .tree-item-self[data-path]');
  const path = row?.dataset.path;
  return row && path && app.vault.getFolderByPath(path) ? row : null;
}

/** `paths` is `null` for tiles from another vault. If the links dialog is dismissed, nothing moves. */
async function dropInto(app: App, folder: string, paths: string[] | null): Promise<void> {
  if (paths === null) {
    new Notice(t('otherVaultTiles'));
    return;
  }
  if (paths.length === 0 || !(await confirmLinkUpdates(app, paths))) return;
  try {
    const result = await moveFiles(app, paths, folder);
    // The moved files form one undo step: Ctrl+Z in the grid brings them back.
    recordMoves(app, result.moved, folder);
    const head = result.moved.length
      ? t('movedInto', { folder, count: result.moved.length })
      : t('nothingMovedInto', { folder });
    moveNotice(head, result);
  } catch (error) {
    console.error('Buba: move into folder', error);
    new Notice(t('moveFailedJournal'));
  }
}

/** Handlers on the document of every Obsidian window, including later ones, like the grid's `onGridEvent`. */
function onDocuments(plugin: Plugin, handlers: Record<DragType, (evt: DragEvent) => void>): void {
  const { workspace } = plugin.app;
  const entries = Object.entries(handlers) as [DragType, (evt: DragEvent) => void][];
  const attached = new Map<Document, () => void>();
  const attach = (doc: Document): void => {
    if (attached.has(doc)) return;
    for (const [type, handler] of entries) doc.addEventListener(type, handler);
    attached.set(doc, () => {
      for (const [type, handler] of entries) doc.removeEventListener(type, handler);
    });
  };
  attach(document);
  workspace.iterateAllLeaves((leaf) => attach(leaf.view.containerEl.doc));
  plugin.registerEvent(workspace.on('window-open', (win) => attach(win.doc)));
  plugin.registerEvent(
    workspace.on('window-close', (win) => {
      attached.get(win.doc)?.();
      attached.delete(win.doc);
    }),
  );
  plugin.register(() => {
    for (const detach of attached.values()) detach();
    attached.clear();
  });
}
