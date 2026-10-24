// Dragging tiles out to other programs: which key starts it and which paths may be handed out. Core rule, no
// `obsidian` import. It is a bounded exception to the public-API-only rule, since Obsidian has no public way
// to drag files out; the `webContents.startDrag` call itself is in src/platform/drag-out.ts.

export type DragOutOs = 'windows' | 'macos' | 'linux';

/** Held modifier keys, as on a mouse event: a `dragstart` event fits as is. */
export interface DragOutKeys {
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * A drag goes outside only while the system key is held: Ctrl on Windows and Linux, Alt on macOS, as in
 * the Drag Out plugin. Without it the drag stays internal (onto a tree folder or the canvas), because
 * during an external drag the Obsidian window does not accept the drop (Electron issue 7118). Other held
 * keys do not cancel it.
 */
export function isDragOutGesture(keys: DragOutKeys, os: DragOutOs): boolean {
  return os === 'macos' ? keys.altKey : keys.ctrlKey;
}

/**
 * Full disk paths for vault paths (`a/b.png` from the vault root). Files outside the vault are never
 * handed out: empty, absolute (any OS) and `..` paths are dropped before their full path is asked for. The
 * host gives the full path (`FileSystemAdapter.getFullPath`) because the name on disk may be in a
 * different Unicode form than the vault path (NFD vs NFC), and joining it with the vault root would give a
 * file that does not exist.
 */
export function dragOutPaths(paths: readonly string[], fullPath: (path: string) => string): string[] {
  return paths.filter(insideVault).map((path) => fullPath(path));
}

// Backslash is a separator on Windows, so `..\x` and `\\server` are caught like `../x` and `/x`.
function insideVault(path: string): boolean {
  if (!path || /^[\\/]|^[a-z]:/i.test(path)) return false;
  return !path.split(/[\\/]/).includes('..');
}
