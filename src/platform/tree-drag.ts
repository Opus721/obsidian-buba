// Drag of a Buba tree row: a folder (moved into another folder) or a tag (moved into a group or out
// of it). Drag data is hidden during `dragover`, yet the tree has to know what is dragged to highlight only
// the rows that take it, so the row lives here from `dragstart` to `dragend`: one drag at a time in all
// Obsidian windows, which share this module. The drag carries only its own type, without `text/plain` or
// Buba tile paths, so other drop targets (canvas, notes, the grid, tile drops on folders and tags) ignore it.
// The picture under the cursor is Obsidian's drag ghost (`drag-ghost`, `drag-ghost-self`: accent background
// and text, as when dragging a file in its file explorer), with the row's icon and name.
import { setIcon } from 'obsidian';

export const BUBA_ROW_TYPE = 'application/x-buba-tree-row';

export type TreeRowDrag = { kind: 'folder'; path: string } | { kind: 'tag'; tag: string };

let current: TreeRowDrag | null = null;

/** Starts a row drag: own type, "move" only, the ghost with `icon` and `name` under the cursor. */
export function startTreeRowDrag(evt: DragEvent, row: TreeRowDrag, icon: string, name: string): void {
  const dt = evt.dataTransfer;
  if (!dt) return;
  current = row;
  dt.clearData();
  dt.setData(BUBA_ROW_TYPE, row.kind);
  dt.effectAllowed = 'move';
  const doc = (evt.target as Node | null)?.ownerDocument ?? document;
  const ghost = doc.body.createDiv({ cls: 'drag-ghost' });
  const self = ghost.createDiv({ cls: 'drag-ghost-self' });
  setIcon(self.createSpan(), icon);
  self.createSpan({ text: name });
  dt.setDragImage(ghost, 0, 0);
  // The browser takes the picture during `dragstart`; the element is not needed after it.
  doc.defaultView?.setTimeout(() => ghost.remove(), 0);
}

/** The dragged row, judged by `types`; `null` for any other drag. */
export function treeRowDrag(dt: Pick<DataTransfer, 'types'> | null): TreeRowDrag | null {
  return dt?.types.includes(BUBA_ROW_TYPE) ? current : null;
}

/** The drag ended, dropped or not. */
export function endTreeRowDrag(): void {
  current = null;
}
