// Writes file cards into a canvas through official paths: an open canvas through its view (getViewData →
// setViewData → requestSave), a closed one through vault.process; the previous content goes to the journal
// before the write. Only types come from `obsidian`: the canvas view is recognized by getViewType() and
// TextFileView methods, not instanceof.
import type { TextFileView, Vault, View, Workspace } from 'obsidian';
import { addFileCards, CanvasError, type CanvasPoint } from './canvas-cards.ts';

/**
 * Action journal: receives the canvas path and its text before the write. If it rejects, nothing is written.
 */
export type CanvasJournal = (entry: { path: string; before: string }) => Promise<void>;

/** What the adapter takes from `app`: public API only. */
type CanvasApp = {
  vault: Pick<Vault, 'getFileByPath' | 'read' | 'process'>;
  workspace: Pick<Workspace, 'getLeavesOfType'>;
};

/**
 * Adds cards for `paths` to the canvas `canvasPath` in a row starting at `at`; returns how many were added.
 * Paths without a vault file are skipped; if none remain the result is 0, with no journal entry and no write.
 */
export async function addCardsToCanvas(
  app: CanvasApp,
  canvasPath: string,
  paths: readonly string[],
  at: CanvasPoint,
  journal: CanvasJournal,
): Promise<number> {
  const files = paths.filter((path) => app.vault.getFileByPath(path) !== null);
  if (files.length === 0) return 0;
  const add = (text: string) => addFileCards(text, files, at);
  const opened = loadedCanvasView(app, canvasPath);
  const before = opened ? opened.getViewData() : await app.vault.read(canvasFile(app, canvasPath));
  await journal({ path: canvasPath, before });
  // The canvas may have been closed or opened while the journal was written, so the write path is chosen
  // again. There is no await between re-reading the view and setViewData, so user edits during the journal
  // write are kept.
  const view = loadedCanvasView(app, canvasPath);
  if (view) {
    view.setViewData(add(view.getViewData()), false);
    view.requestSave();
  } else {
    await app.vault.process(canvasFile(app, canvasPath), add);
  }
  return files.length;
}

function loadedCanvasView(app: CanvasApp, canvasPath: string): TextFileView | null {
  for (const leaf of app.workspace.getLeavesOfType('canvas')) {
    const view: View & Partial<TextFileView> = leaf.view;
    if (
      !leaf.isDeferred &&
      view.getViewType() === 'canvas' &&
      view.file?.path === canvasPath &&
      isTextView(view)
    ) {
      return view;
    }
  }
  return null;
}

function isTextView(view: View & Partial<TextFileView>): view is View & TextFileView {
  return (
    typeof view.getViewData === 'function' &&
    typeof view.setViewData === 'function' &&
    typeof view.requestSave === 'function'
  );
}

function canvasFile(app: CanvasApp, canvasPath: string) {
  const file = app.vault.getFileByPath(canvasPath);
  if (!file) throw new CanvasError('not-found', `Canvas not found in vault: ${canvasPath}`, canvasPath);
  return file;
}
