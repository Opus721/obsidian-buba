// What "Go to font installation" knows without `obsidian`: which files are fonts (the extensions the system
// installs) and what the hint over the grid says on each system. The system installs the fonts dropped into
// its own font window; Buba only opens that window (src/platform/fonts.ts) and writes nothing outside the vault.
import { t } from '../i18n/dict/actions.ts';

/** TrueType, OpenType and collections: what both Windows Settings and Font Book install. */
export const FONT_EXTENSIONS: readonly string[] = ['ttf', 'otf', 'ttc'];

export function isFontExtension(extension: string): boolean {
  return FONT_EXTENSIONS.includes(extension.toLowerCase());
}

/** The systems with a font window that takes dropped files. */
export type FontSystem = 'windows' | 'macos';

/**
 * The hint shown when the font window opens: which key to hold and where to drop. The key is the drag-out key
 * (src/core/actions/drag-out.ts): Ctrl on Windows, Option on macOS.
 */
export function fontHint(system: FontSystem): string {
  return system === 'macos' ? t('fontHintMac') : t('fontHintWindows');
}
