// Opens the system's own font window, where the user drops font files to install them: on Windows the Fonts
// page of Settings (`ms-settings:fonts`, with its "Drag and drop to install" field), on macOS Font Book. Buba
// writes nothing outside the vault and starts no program; the system installs what is dropped, many fonts at
// once. Electron's `shell` comes from `@electron/remote`, as for dragging out (src/platform/drag-out.ts), through
// `window.require` behind a platform check: the plugin also loads on phones. Both opens take constant addresses
// only; they are the two lines tools/check-sinks.mjs allows here. What a font file is and the hint:
// src/core/actions/font-install.ts.
import { Platform } from 'obsidian';
import type { FontSystem } from '../core/actions/font-install.ts';

// Our own type for the part of Electron's `shell` we use: `electron` is not a dependency.
interface Shell {
  openExternal: (url: string) => Promise<void>;
  /** Resolves to an error text, empty on success. */
  openPath: (path: string) => Promise<string>;
}

/** Font Book: in /System/Applications since macOS 10.15, in /Applications before. */
const FONT_BOOK = ['/System/Applications/Font Book.app', '/Applications/Font Book.app'];

/** The system whose font window takes dropped files, or `null`: phones and Linux have none. */
export function fontSystem(): FontSystem | null {
  if (!remoteShell()) return null;
  if (Platform.isWin) return 'windows';
  if (Platform.isMacOS) return 'macos';
  return null;
}

/** Opens the font window; `false` when the system refused. */
export async function openFontWindow(system: FontSystem): Promise<boolean> {
  const shell = remoteShell();
  if (!shell) return false;
  try {
    if (system === 'windows') {
      await shell.openExternal('ms-settings:fonts');
      return true;
    }
    for (const fontBook of FONT_BOOK) {
      if ((await shell.openPath(fontBook)) === '') return true;
    }
  } catch (error) {
    console.error('Buba: font window not opened', error);
  }
  return false;
}

/** Electron's `shell` in the desktop app; a missing method throws in the call and is caught there. */
function remoteShell(): Shell | null {
  if (!Platform.isDesktopApp) return null;
  try {
    const remote = window.require('@electron/remote') as { shell?: Shell } | undefined;
    return remote?.shell ?? null;
  } catch {
    return null;
  }
}
