// The full path of a vault file on disk, as the system file manager shows it (`D:\Projects\a\b.psd`): on a
// computer from `FileSystemAdapter.getFullPath`; on a phone, where no other app opens it by path, the vault
// path. The adapter is told by its method, not by `instanceof`, so fakes need no class.
import { Platform, type App } from 'obsidian';

export function diskPath(app: App, path: string): string {
  const adapter = app.vault.adapter as { getFullPath?: (normalizedPath: string) => string };
  if (!Platform.isDesktopApp || typeof adapter.getFullPath !== 'function') return path;
  try {
    return adapter.getFullPath(path);
  } catch {
    return path;
  }
}
