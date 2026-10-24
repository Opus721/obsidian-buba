// Dragging out on desktop: the system gets the real vault files, not an `obsidian://` link.
// `webContents.startDrag` lives in Electron's main process and is reached from the window through
// `@electron/remote`, which Obsidian itself loads. This is the one exception to "public API only"; recheck it
// on every Obsidian update. There is no static import of `electron` or `@electron/remote`: the plugin also
// loads on phones (`isDesktopOnly: false`), so only `window.require` behind a platform check. Which key and
// which paths: src/core/actions/drag-out.ts.
import { FileSystemAdapter, Platform, type App } from 'obsidian';
import { dragOutPaths } from '../core/actions/drag-out.ts';

// Our own types for the Electron parts we use: `electron` is not a dependency.
interface DragIcon {
  isEmpty(): boolean;
}

interface ElectronRemote {
  getCurrentWebContents(): { startDrag(item: { file: string; files: string[]; icon: DragIcon }): void };
  nativeImage: { createFromDataURL(dataUrl: string): DragIcon };
}

// Transparent 1×1 PNG used when there is no icon: on macOS `startDrag` with an empty icon throws.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';

/** Whether files can be dragged out: desktop app, and `@electron/remote` provides `getCurrentWebContents`. */
export function dragOutAvailable(): boolean {
  return electronRemote() !== null;
}

/**
 * Starts a system drag of vault files by their paths (`a/b.png`); the full disk path comes from
 * `FileSystemAdapter.getFullPath`, which knows the real file name on disk. Called from a tile's `dragstart`
 * for the drag-out gesture (`isDragOutGesture`); on `true` the caller cancels the event (`preventDefault`).
 * The icon is a `data:` PNG or JPEG at its own size (`nativeImage` reads no other formats), otherwise a
 * transparent pixel. `false` means not started: not desktop, no `@electron/remote`, or no path inside the
 * vault. On Windows the call blocks the window until the file is dropped (electron/electron issue 45197).
 */
export function startDragOut(app: App, paths: readonly string[], iconDataUrl?: string): boolean {
  const remote = electronRemote();
  const adapter = app.vault.adapter;
  if (!remote || !(adapter instanceof FileSystemAdapter)) return false;
  const files = dragOutPaths(paths, (path) => adapter.getFullPath(path));
  const [file] = files;
  if (file === undefined) return false;
  remote.getCurrentWebContents().startDrag({ file, files, icon: dragIcon(remote, iconDataUrl) });
  return true;
}

function dragIcon(remote: ElectronRemote, dataUrl: string | undefined): DragIcon {
  const icon = dataUrl ? remote.nativeImage.createFromDataURL(dataUrl) : null;
  return icon && !icon.isEmpty() ? icon : remote.nativeImage.createFromDataURL(PIXEL);
}

function electronRemote(): ElectronRemote | null {
  if (!Platform.isDesktopApp) return null;
  try {
    const remote = window.require('@electron/remote') as Partial<ElectronRemote> | undefined;
    return typeof remote?.getCurrentWebContents === 'function' ? (remote as ElectronRemote) : null;
  } catch {
    return null;
  }
}
