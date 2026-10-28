// Start of a tile drag: the selection is dragged; a tile outside the selection is dragged alone. Without a
// key, Buba data (src/platform/canvas-drag.ts) for the tree and the canvas; with Ctrl on Windows or Alt on
// macOS, real files out of Obsidian (src/platform/drag-out.ts, desktop only). The grid contract has no
// `draggable`: a press on a tile sets it, so the grid files stay untouched.
// The picture under the cursor is Obsidian's drag ghost with a small preview of the pressed tile and its name
// (or the count), the cursor at its top left corner: the folder under the cursor stays in sight, as in the
// file explorer. The browser's own picture is the whole tile, held where it was pressed, and covers the folder.
import { getIcon, Platform, type Plugin } from 'obsidian';
import { isDragOutGesture, type DragOutOs } from '../../core/actions/drag-out.ts';
import { t } from '../../core/i18n/dict/actions.ts';
import { markOwnTileDrag, setBubaDragData } from '../../platform/canvas-drag.ts';
import { dragOutAvailable, startDragOut } from '../../platform/drag-out.ts';
import type { BubaAssets } from '../api.ts';
import { onGridEvent, selectedFor } from '../grid/selection.ts';
import './tile-drag.css';

// The source vault mark lives in the platform layer; re-exported here for drops on the tree.
export { isOwnTileDrag } from '../../platform/canvas-drag.ts';

/** Long side of the drag-out icon, px. */
const ICON_PX = 64;
/** Long side of the preview in the drag ghost, px. */
const GHOST_PX = 96;

export function registerTileDrag(plugin: Plugin, assets: BubaAssets): void {
  const { app } = plugin;
  const os: DragOutOs = Platform.isMacOS ? 'macos' : Platform.isWin ? 'windows' : 'linux';
  onGridEvent(plugin, assets, 'pointerdown', (evt) => {
    const tile = tileOf(evt.target);
    // On a phone tiles are not draggable: a long press opens the file menu and moving uses its "Move to…"; on
    // iOS a draggable tile would start a system drag instead of the menu.
    if (tile && !Platform.isMobile) tile.draggable = true;
  });
  onGridEvent(plugin, assets, 'dragstart', (evt, { view, path }) => {
    const tile = tileOf(evt.target);
    const dt = evt.dataTransfer;
    if (path === null || !tile || !dt) return;
    const paths = selectedFor(view, path);
    if (isDragOutGesture(evt, os) && dragOutAvailable()) {
      evt.preventDefault();
      startDragOut(app, paths, previewIcon(tile));
      return;
    }
    // A press on an image inside the tile starts dragging the image with its data; we carry only our own.
    dt.clearData();
    setBubaDragData(dt, paths, app.vault.getName());
    markOwnTileDrag(dt);
    dt.effectAllowed = 'copyMove';
    setGhost(dt, tile, paths.length);
  });
}

/** Obsidian's drag ghost under the cursor: the tile's preview, the file name or the count of dragged files. */
function setGhost(dt: DataTransfer, tile: HTMLElement, count: number): void {
  const doc = tile.ownerDocument;
  const ghost = doc.body.createDiv({ cls: 'drag-ghost buba-tile-ghost' });
  const preview = previewCanvas(tile, GHOST_PX);
  if (preview) ghost.appendChild(preview);
  const self = ghost.createDiv({ cls: 'drag-ghost-self' });
  // The icon is the row's direct child, as Obsidian's `.drag-ghost-self > .svg-icon` sizes it.
  const icon = getIcon(count > 1 ? 'files' : 'file');
  if (icon) self.appendChild(icon);
  const name = tile.dataset.path?.split('/').pop() ?? '';
  self.createSpan({ text: count > 1 ? t('dragCount', { count }) : name });
  dt.setDragImage(ghost, 0, 0);
  // The browser takes the picture during `dragstart`; the element is not needed after it.
  doc.defaultView?.setTimeout(() => ghost.remove(), 0);
}

function tileOf(target: EventTarget | null): HTMLElement | null {
  const el = target as Element | null;
  return typeof el?.closest === 'function' ? el.closest<HTMLElement>('.buba-tile[data-path]') : null;
}

/** Tile preview scaled down to `px` on the long side; none while the tile has no loaded preview. */
function previewCanvas(tile: HTMLElement, px: number): HTMLCanvasElement | null {
  const img = tile.querySelector('img');
  if (!img?.complete || !img.naturalWidth || !img.naturalHeight) return null;
  const scale = Math.min(1, px / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = createEl('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Tile preview scaled down to 64 px as a PNG `data:` URL; none without a preview or for a cross-origin image.
 */
function previewIcon(tile: HTMLElement): string | undefined {
  const canvas = previewCanvas(tile, ICON_PX);
  if (!canvas) return undefined;
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  }
}
