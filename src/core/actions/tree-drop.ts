// Drop onto a Buba tree row: what a folder row does with what is dragged onto it. Core rule, no `obsidian`
// import. Like Obsidian's own file explorer: system files dropped on a folder are copied into it; Buba tiles
// are moved; a folder dragged from the tree is moved into the folder under it, or into the vault root over
// "All files" and the empty space below the folders. Receiving the drop and writing is in
// src/assets/actions/tree-drop.ts.
import { parentFolder, ROOT } from './new-folder.ts';

/** What is being dragged, from the drag `types`: data cannot be read during `dragover`. */
export interface TreeDragKind {
  /** Buba tile data (`hasBubaDragData`). */
  buba: boolean;
  /** System files (`types` contains `Files`). */
  files: boolean;
  /** Path of a folder dragged from the Buba tree (src/platform/tree-drag.ts); absent or `null` otherwise. */
  folder?: string | null;
}

export interface TreeDropTarget {
  action: 'move' | 'copy';
  /** Folder path from the vault root. */
  folder: string;
}

/**
 * Drop target of a tree row: `folder` is the row's folder path, `ROOT` the vault root ("All files" and the
 * empty space below the folders), `null` means the row is not a folder ("Untagged", a tag). A dragged folder
 * goes by `folderDrop`; the root takes only a folder. Own data wins over system data: Buba tiles are moved
 * even if files come with them. Neither tiles nor files (text, a link from a note) is not a target.
 */
export function treeDrop(drag: TreeDragKind, folder: string | null): TreeDropTarget | null {
  if (folder === null) return null;
  if (drag.folder) {
    const to = folderDrop(drag.folder, folder);
    return to === null ? null : { action: 'move', folder: to };
  }
  if (folder === ROOT) return null;
  if (drag.buba) return { action: 'move', folder };
  if (drag.files) return { action: 'copy', folder };
  return null;
}

/**
 * Where folder `dragged` goes when dropped on `target` (a folder path or `ROOT`): into `target`, or `null`
 * when the drop changes nothing or cannot be done, so the row is not highlighted: the folder itself, a
 * folder inside it (Obsidian refuses to move a folder into itself), and the folder it is already in.
 */
export function folderDrop(dragged: string, target: string): string | null {
  if (target === dragged || target.startsWith(`${dragged}/`)) return null;
  return parentFolder(dragged) === target ? null : target;
}
