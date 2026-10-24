// "On boards" panel section (`buba-boards`, order 55): the canvases that contain the one shown file, by name
// with their folder; a click opens the canvas. Obsidian collects canvas links (`metadataCache.resolvedLinks`,
// the `resolve` event; src/core/inspector/boards.ts), so the `src/canvas` bridge is not needed. The section
// keeps its own canvas list: `vault.getFiles()` on the first draw, then vault events, so a draw reads only
// the entries of known canvases. Right after Obsidian starts the list can be incomplete: canvases are indexed
// gradually and the section redraws on `resolve`. Rows use the markup of Obsidian's "Outgoing links"; name
// and folder are text only.
import { Keymap, setIcon, TFile, type Plugin, type TAbstractFile } from 'obsidian';
import { t } from '../../core/i18n/dict/inspector.ts';
import { boardFolder, boardName, boardsWith, CanvasList, isOnBoard } from '../../core/inspector/boards.ts';
import type { InspectorSection } from './sections.ts';

export const BOARDS_SECTION_ID = 'buba-boards';

/**
 * `list`: the canvas list changed (a canvas appeared, left or moved); `links`: Obsidian re-read a canvas's
 * links.
 */
type Change = 'list' | 'links';

/** Vault canvases and the drawn sections waiting for their changes. */
interface Boards {
  list: CanvasList;
  listeners: Set<(canvas: string, change: Change) => void>;
}

/**
 * A canvas as Obsidian indexes it (the canvas `canProcess`, Obsidian 1.14): a file with the `canvas`
 * extension.
 */
function isCanvas(file: TAbstractFile): file is TFile {
  return file instanceof TFile && file.extension === 'canvas';
}

/** Canvas list plus vault and link cache subscriptions, set up once until the plugin unloads. */
function watchBoards(plugin: Plugin): Boards {
  const { vault, metadataCache } = plugin.app;
  const list = new CanvasList();
  for (const file of vault.getFiles()) if (isCanvas(file)) list.add(file.path);
  const listeners = new Set<(canvas: string, change: Change) => void>();
  const tell = (canvas: string, change: Change): void => {
    for (const listener of [...listeners]) listener(canvas, change);
  };
  plugin.registerEvent(
    vault.on('create', (file) => {
      if (isCanvas(file) && list.add(file.path)) tell(file.path, 'list');
    }),
  );
  plugin.registerEvent(
    vault.on('delete', (file) => {
      if (list.delete(file.path)) tell(file.path, 'list');
    }),
  );
  // Obsidian moves a folder with an event for the folder, then one for each file under it (adapter `renamed`,
  // Obsidian 1.14). The folder move has already shifted the canvas paths, but a file is found at its new path
  // only after its own event, so a canvas move redraws the section even when the list did not change.
  plugin.registerEvent(
    vault.on('rename', (file, oldPath) => {
      if (!(file instanceof TFile)) {
        if (list.move(oldPath, file.path)) tell(file.path, 'list');
        return;
      }
      const was = list.delete(oldPath);
      const is = isCanvas(file);
      if (is) list.add(file.path);
      if (was || is) tell(file.path, 'list');
    }),
  );
  // A canvas the vault has not reported yet (Obsidian starting up) joins the list on its own `resolve`.
  plugin.registerEvent(
    metadataCache.on('resolve', (file) => {
      if (isCanvas(file)) tell(file.path, list.add(file.path) ? 'list' : 'links');
    }),
  );
  return { list, listeners };
}

export function boardsSection(plugin: Plugin): InspectorSection {
  let boards: Boards | null = null;
  return {
    id: BOARDS_SECTION_ID,
    order: 55,
    // Hidden for several files, like "Resolution": boards are a property of one file.
    render(el, paths) {
      const [only] = paths;
      if (only === undefined || paths.length > 1) {
        el.hide();
        return;
      }
      const state = (boards ??= watchBoards(plugin));
      const { vault, metadataCache, workspace } = plugin.app;
      el.createDiv({ cls: 'buba-storage-heading', text: t('boardsTitle') });
      const body = el.createDiv();
      let shown = new Set<string>();
      const draw = (): void => {
        body.empty();
        const found = boardsWith(only, state.list, metadataCache.resolvedLinks);
        shown = new Set(found);
        if (!found.length) {
          body.createDiv({ cls: 'buba-storage-note', text: t('boardsNone') });
          return;
        }
        for (const path of found) {
          const canvas = vault.getFileByPath(path);
          if (!canvas) continue;
          const row = body.createDiv({ cls: 'tree-item' }).createDiv({ cls: 'tree-item-self is-clickable' });
          setIcon(row.createSpan({ cls: 'tree-item-icon' }), 'layout-dashboard');
          const inner = row.createDiv({ cls: 'tree-item-inner' });
          inner.createDiv({ cls: 'tree-item-inner-text', text: boardName(path) });
          const folder = boardFolder(path);
          if (folder) inner.createDiv({ cls: 'tree-item-inner-subtext', text: folder });
          // Like a row of Obsidian's "Outgoing links": left and middle button, the leaf by
          // `Keymap.isModEvent`; with no modifier the canvas replaces the grid in its tab and "Back" returns
          // to the grid. The middle button press is cancelled, as on Obsidian's search and file explorer rows
          // (Obsidian 1.14): otherwise Windows starts middle-button autoscroll and no `auxclick` follows.
          row.addEventListener('mousedown', (evt) => {
            if (evt.button === 1) evt.preventDefault();
          });
          row.onClickEvent((evt) => {
            if (evt.button !== 0 && evt.button !== 1) return;
            workspace
              .getLeaf(Keymap.isModEvent(evt))
              .openFile(canvas)
              .catch((error: unknown) => console.error('Buba: canvas did not open', error));
          });
        }
      };
      draw();
      // New canvas links redraw the section only if the file appeared on or disappeared from this canvas.
      const listener = (canvas: string, change: Change): void => {
        if (change === 'links' && shown.has(canvas) === isOnBoard(only, canvas, metadataCache.resolvedLinks))
          return;
        draw();
      };
      state.listeners.add(listener);
      return () => {
        state.listeners.delete(listener);
      };
    },
  };
}
