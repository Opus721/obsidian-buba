// Dropping Buba tiles onto an open canvas. From a foreign drag the canvas itself makes a single text card,
// and it makes file cards only from the internal `app.dragManager`, which we do not use. So a drop carrying
// the Buba type is taken before the canvas, in the capture phase on the window document, and cards are added
// through the canvas view (src/platform/canvas-write.ts). A drop without the Buba type is left to the canvas.
import {
  apiVersion,
  Notice,
  type App,
  type TFile,
  type TextFileView,
  type View,
  type WorkspaceLeaf,
} from 'obsidian';
import { t } from '../core/i18n/dict/canvas.ts';
import {
  canvasPointFromClient,
  pointRightOfContent,
  type CanvasPoint,
  type CanvasViewport,
  CanvasError,
} from '../platform/canvas-cards.ts';
import { hasBubaDragData, isOwnTileDrag, readBubaDragPaths } from '../platform/canvas-drag.ts';
import { addCardsToCanvas } from '../platform/canvas-write.ts';
import { deviceId } from '../platform/device.ts';
import { actionJournal, type ActionJournal } from '../platform/files/action-journal.ts';
import { confirmCards } from './confirm.ts';

/** Dropping more cards than this at once asks for confirmation with the count. */
export const CONFIRM_ABOVE = 100;

type CanvasTarget = { leaf: WorkspaceLeaf; view: View & TextFileView; file: TFile };

/** `dragover` and `drop` handlers for a window document; the action log is created on the first drop. */
export function canvasDrop(app: App): { dragover: (evt: DragEvent) => void; drop: (evt: DragEvent) => void } {
  let journal: ActionJournal | null = null;

  const dragover = (evt: DragEvent): void => {
    const dt = evt.dataTransfer;
    if (!dt || !hasBubaDragData(dt) || !canvasAt(app, evt.target)) return;
    evt.preventDefault();
    evt.stopPropagation();
    dt.dropEffect = 'copy';
  };

  // Everything before the first `await` runs inside the `drop` handler: drag data is readable only there.
  const accept = async (target: CanvasTarget, dt: DataTransfer, x: number, y: number): Promise<void> => {
    try {
      if (!isOwnTileDrag(dt)) {
        new Notice(t('otherVault'));
        return;
      }
      const paths = readBubaDragPaths(dt) ?? [];
      const at = dropPoint(target, x, y);
      const count = paths.filter((path) => app.vault.getFileByPath(path) !== null).length;
      if (count > CONFIRM_ABOVE && !(await confirmCards(app, count))) return;
      journal ??= actionJournal(app, deviceId(app));
      await addCardsToCanvas(app, target.file.path, paths, at, journal.recordCanvasWrite);
    } catch (error) {
      console.error('Buba: cards not added to canvas', error);
      new Notice(t('notAdded', { reason: dropReason(error) }));
    }
  };

  const drop = (evt: DragEvent): void => {
    const dt = evt.dataTransfer;
    if (!dt || !hasBubaDragData(dt)) return;
    const target = canvasAt(app, evt.target);
    if (!target) return;
    evt.preventDefault();
    evt.stopPropagation();
    void accept(target, dt, evt.clientX, evt.clientY);
  };

  return { dragover, drop };
}

/**
 * Reason for the notice in the Buba language: canvas parse or write failures
 * are mapped by code to dictionary text (the English error text goes only to
 * the console); anything else is shown as Obsidian or the system gave it.
 */
export function dropReason(error: unknown): string {
  if (error instanceof CanvasError) {
    if (error.code === 'not-found') return t('reasonNotFound', { path: error.path });
    if (error.code === 'nodes') return t('reasonNodes');
    if (error.code === 'no-id') return t('reasonNoId');
    return t('reasonNotJson');
  }
  return error instanceof Error ? error.message : String(error);
}

/** The canvas leaf containing the event target; a canvas without a file or view text is not a target. */
function canvasAt(app: App, eventTarget: EventTarget | null): CanvasTarget | null {
  const el = eventTarget as Element | null;
  if (typeof el?.closest !== 'function') return null;
  for (const leaf of app.workspace.getLeavesOfType('canvas')) {
    const view: View & Partial<TextFileView> = leaf.view;
    if (!view.containerEl.contains(el) || !view.file || typeof view.getViewData !== 'function') continue;
    return { leaf, view: view as View & TextFileView, file: view.file };
  }
  return null;
}

/**
 * Canvas point under the drop point, from the leaf's public `getViewState()`. If the viewport is not
 * readable, cards go to the right of everything, with a console warning naming the Obsidian version, so it is
 * clear after which update it disappeared.
 */
function dropPoint({ leaf, view }: CanvasTarget, x: number, y: number): CanvasPoint {
  const viewport = viewportOf(leaf);
  if (viewport) return canvasPointFromClient(viewport, view.contentEl.getBoundingClientRect(), x, y);
  console.warn(
    `Buba: canvas viewport not readable (Obsidian ${apiVersion}) — cards placed to the right of everything`,
  );
  return pointRightOfContent(view.getViewData());
}

function viewportOf(leaf: WorkspaceLeaf): CanvasViewport | null {
  const raw = leaf.getViewState().state?.viewState;
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y, zoom } = raw as Record<string, unknown>;
  return isNumber(x) && isNumber(y) && isNumber(zoom) ? { x, y, zoom } : null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
