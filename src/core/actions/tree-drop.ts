// Drop onto a Buba tree row: what a folder row does with what is dragged onto it. Core rule, no `obsidian`
// import. Like Obsidian's own file explorer: system files dropped on a folder are copied into it; Buba tiles
// are moved. Receiving the drop and writing is in src/assets/actions/tree-drop.ts.

/** What is being dragged, from the drag `types`: data cannot be read during `dragover`. */
export interface TreeDragKind {
  /** Buba tile data (`hasBubaDragData`). */
  buba: boolean;
  /** System files (`types` contains `Files`). */
  files: boolean;
}

export interface TreeDropTarget {
  action: 'move' | 'copy';
  /** Folder path from the vault root. */
  folder: string;
}

/**
 * Drop target of a tree row: `folder` is the row's folder path, `null` means the row is not a folder ("All
 * files", "Untagged", a tag). Own data wins over system data: Buba tiles are moved even if files come with
 * them. Neither tiles nor files (text, a link from a note) is not a target.
 */
export function treeDrop(drag: TreeDragKind, folder: string | null): TreeDropTarget | null {
  if (folder === null) return null;
  if (drag.buba) return { action: 'move', folder };
  if (drag.files) return { action: 'copy', folder };
  return null;
}
