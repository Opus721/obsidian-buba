// "Copy path" button next to a single file's path in the "File" section: an Obsidian icon button with the
// `copy` icon, like Obsidian's code block copy button. The path goes to the clipboard via
// `navigator.clipboard.writeText`, as Obsidian's "Copy" menu items do, followed by a notice. The path is only
// ever text, never markup.
import { ExtraButtonComponent, Notice } from 'obsidian';
import { t } from '../../core/i18n/dict/inspector.ts';
import { iconButton } from '../../platform/icon-button.ts';

/** Icon button in `el` that copies `path` to the clipboard; medium size, the height of a panel row. */
export function copyPathButton(el: HTMLElement, path: string): void {
  const button = new ExtraButtonComponent(el)
    .setIcon('copy')
    .setTooltip(t('copyPath'))
    .onClick(() => void copyPath(path));
  iconButton(button.extraSettingsEl, 'medium');
}

export async function copyPath(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(path);
    new Notice(t('pathCopied'));
  } catch (error) {
    console.error('Buba: path not copied', error);
    new Notice(t('pathCopyFailed'));
  }
}
