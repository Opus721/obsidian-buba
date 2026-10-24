// Drag data format of Buba tiles, without importing `obsidian`: a custom type carrying file paths, plus
// `text/plain` and `text/uri-list` with `obsidian://open` links as Obsidian's file tree sets them, so a drop
// into a note or another app behaves like a drop from the tree. A custom type alongside standard ones is the
// recommended practice:
// https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Recommended_drag_types

export const BUBA_PATHS_TYPE = 'application/x-buba-paths';

// `dt` may be null so that callers can pass `evt.dataTransfer` as is and still type-check.

/**
 * Puts vault file paths into a drag: the custom type holds a JSON array of paths, the links go one per line.
 */
export function setBubaDragData(
  dt: Pick<DataTransfer, 'setData'> | null,
  paths: readonly string[],
  vaultName: string,
): void {
  if (!dt) return;
  const links = paths.map((path) => obsidianUrl(vaultName, path)).join('\n');
  dt.setData(BUBA_PATHS_TYPE, JSON.stringify(paths));
  dt.setData('text/plain', links);
  dt.setData('text/uri-list', links);
}

/** Whether a drag carries Buba paths, judged by `types`: data cannot be read during `dragover`. */
export function hasBubaDragData(dt: Pick<DataTransfer, 'types'> | null): boolean {
  return dt?.types.includes(BUBA_PATHS_TYPE) ?? false;
}

/**
 * Which vault the tiles come from: tiles dropped from an Obsidian window with another vault must not add or
 * move files with the same paths here. The value is unique per plugin load: a vault window and its popouts
 * share it (one plugin instance), another vault's window has a different one. It lives in the platform layer,
 * not the tile module, so canvas and tree drop handlers can read it without importing another module.
 */
export const BUBA_SOURCE_TYPE = 'application/x-buba-source';
const SOURCE = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Marks a drag as coming from this vault, next to the `setBubaDragData` data. */
export function markOwnTileDrag(dt: Pick<DataTransfer, 'setData'> | null): void {
  dt?.setData(BUBA_SOURCE_TYPE, SOURCE);
}

/**
 * Whether the tiles come from this vault; read in `drop`, since data is hidden in `dragover` (always false
 * there).
 */
export function isOwnTileDrag(dt: Pick<DataTransfer, 'getData'> | null): boolean {
  return dt?.getData(BUBA_SOURCE_TYPE) === SOURCE;
}

/**
 * Paths from a Buba drag; `null` for another type, invalid JSON or a non-array; non-string items are dropped.
 */
export function readBubaDragPaths(dt: Pick<DataTransfer, 'types' | 'getData'> | null): string[] | null {
  if (!dt || !hasBubaDragData(dt)) return null;
  let data: unknown;
  try {
    data = JSON.parse(dt.getData(BUBA_PATHS_TYPE));
  } catch {
    return null;
  }
  return Array.isArray(data) ? data.filter((item): item is string => typeof item === 'string') : null;
}

// Same as App.getObsidianUrl in Obsidian 1.13.7: vault name and path are encodeURIComponent'ed and a .md note
// loses its extension; for several files the tree joins links with \n.
function obsidianUrl(vaultName: string, path: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(withoutMd(path))}`;
}

function withoutMd(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const markdown = dot > 0 && name.slice(dot + 1).toLowerCase() === 'md';
  return markdown ? path.slice(0, path.length - name.length + dot) : path;
}
