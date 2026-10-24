// "Link" panel section (`buba-link`, order 45): for one file, its link field and an "Open link" button, like
// the URL field in the Eagle inspector. Links are http and https only (storage's `normalizeLink`): a journal
// line from another device is external input, and the button never opens a link with another scheme. Opening
// uses the element window's `open` with target `_blank`, like an Obsidian property link (Obsidian 1.14), so
// it goes to the system browser; it is the only way out of `src` (`tools/check-sinks.mjs`). The address is
// only ever a field value, never HTML.
import { ExtraButtonComponent, Notice, TextComponent, type Plugin, type TFile } from 'obsidian';
import { t } from '../../core/i18n/dict/inspector.ts';
import { isLinkUrl, linkFault, normalizeLink } from '../../core/storage/link.ts';
import type { BubaStorage, FileLinks } from '../../core/storage/types.ts';
import { iconButton } from '../../platform/icon-button.ts';
import type { InspectorSection } from './sections.ts';
import './link-section.css';

export const LINK_SECTION_ID = 'buba-link';

type LinkStorage = BubaStorage & FileLinks;

/** Storage with links is the plugin's `storage` field, read on every draw: it opens after load. */
function linkStorageOf(plugin: Plugin): LinkStorage | null {
  const storage = (plugin as Plugin & { storage?: BubaStorage & Partial<FileLinks> }).storage;
  return storage && typeof storage.link === 'function' && typeof storage.setLink === 'function'
    ? (storage as LinkStorage)
    : null;
}

/**
 * Text typed in the link field while the panel redraws: the section cleanup hands it to the draw of the same
 * file (the same `TFile`, which survives edits and renames), like the name field of the "File" section
 * (`file-section.ts`).
 */
interface Typed {
  file: TFile;
  value: string;
  start: number | null;
  end: number | null;
  direction: 'forward' | 'backward' | 'none' | null;
}

/** Passes typed text from the section cleanup to the next draw; lives for one panel redraw. */
interface Handoff {
  typed: Typed | null;
}

export function linkSection(plugin: Plugin): InspectorSection {
  const handoff: Handoff = { typed: null };
  return {
    id: LINK_SECTION_ID,
    order: 45,
    render(el, paths) {
      // Typed text waits only for the draw of the same file in this redraw; another file does not get it.
      const typed = handoff.typed;
      handoff.typed = null;
      el.createDiv({ cls: 'buba-storage-heading', text: t('linkTitle') });
      const [path] = paths;
      if (paths.length !== 1 || path === undefined) {
        el.createDiv({ cls: 'buba-storage-note', text: t('linkOneFile') });
        return;
      }
      const storage = linkStorageOf(plugin);
      if (!storage) {
        el.createDiv({ cls: 'buba-storage-note', text: t('storageClosed') });
        return;
      }
      const file = plugin.app.vault.getFileByPath(path);
      if (!file) return;
      return renderLink(el, storage, file, handoff, typed?.file === file ? typed : null);
    },
  };
}

function renderLink(
  el: HTMLElement,
  storage: LinkStorage,
  file: TFile,
  handoff: Handoff,
  typed: Typed | null,
): () => void {
  const saved = (): string => storage.link(file.path) ?? '';
  const row = el.createDiv({ cls: 'buba-link' });
  // A text field with the URL keyboard, like Obsidian's own fields (`inputMode`): `type="url"` has no
  // Obsidian styling.
  const input = new TextComponent(row).setPlaceholder('https://…').setValue(saved());
  const { inputEl } = input;
  inputEl.inputMode = 'url';
  inputEl.spellcheck = false;
  inputEl.autocapitalize = 'off';
  inputEl.setAttr('aria-label', t('linkField'));
  const button = new ExtraButtonComponent(row).setIcon('external-link').setTooltip(t('openLink'));
  iconButton(button.extraSettingsEl, 'medium');
  const copy = new ExtraButtonComponent(row).setIcon('copy').setTooltip(t('copyLink'));
  iconButton(copy.extraSettingsEl, 'medium');

  // `held`: leaving the field by pressing the button rejected an invalid value, so this press does not open
  // the old link. Cleared when the press ends (click) or the field is entered. A rejection on Enter or on
  // leaving to elsewhere does not hold the button: the field shows the saved link again and the button opens
  // it. `pressing`: the button was pressed since the field was entered.
  let held = false;
  let pressing = false;
  const sync = (): void => {
    const off = held || normalizeLink(input.getValue()) === null;
    for (const action of [button, copy]) {
      action.setDisabled(off);
      // Obsidian styles a disabled icon button by `aria-disabled`.
      action.extraSettingsEl.setAttr('aria-disabled', String(off));
    }
  };
  input.onChange(() => {
    held = false;
    sync();
  });
  inputEl.addEventListener('focus', () => {
    held = false;
    pressing = false;
    sync();
  });
  // The panel redrew while a link was being typed: the typed text, focus and selection go back into the
  // field.
  if (typed) {
    input.setValue(typed.value);
    inputEl.focus();
    inputEl.setSelectionRange(typed.start, typed.end, typed.direction ?? undefined);
  }
  sync();

  // `closed`: the panel redrew and the field is off screen, so its blur saves nothing.
  let closed = false;
  const commit = async (): Promise<void> => {
    if (closed) return;
    const current = storage.link(file.path);
    const text = input.getValue().trim();
    const url = text === '' ? null : normalizeLink(text);
    if (text !== '' && url === null) {
      // The reason comes from storage, in check order: invisible characters, user and password before @,
      // other.
      const fault = linkFault(text);
      new Notice(
        fault === 'hidden'
          ? t('linkHidden')
          : fault === 'credentials'
            ? t('linkCredentials')
            : t('linkScheme', { http: 'http://', https: 'https://' }),
      );
      held = pressing;
      input.setValue(current ?? '');
      sync();
      return;
    }
    input.setValue(url ?? '');
    sync();
    if (url === current) return;
    try {
      await storage.setLink(file.path, url);
    } catch (error) {
      console.error('Buba: link not saved', error);
      new Notice(t('linkSaveFailed'));
      if (!closed) {
        input.setValue(saved());
        sync();
      }
    }
  };
  // Enter moves focus off the field, and leaving it saves: one save point for both paths. Escape restores the
  // saved link.
  inputEl.addEventListener('keydown', (evt) => {
    if (evt.isComposing || (evt.key !== 'Enter' && evt.key !== 'Escape')) return;
    evt.preventDefault();
    if (evt.key === 'Escape') {
      evt.stopPropagation();
      input.setValue(saved());
      sync();
    }
    inputEl.blur();
  });
  inputEl.addEventListener('blur', () => void commit());

  // Open within the same press, before saving: iPhone's browser opens a window only from the tap itself. A
  // strict check runs again before opening: the field may still hold a link of another scheme that storage
  // returned.
  button.onClick(() => {
    if (held) return;
    const url = normalizeLink(input.getValue());
    if (url === null || !isLinkUrl(url)) return;
    el.win.open(url, '_blank');
    void commit();
  });
  // Copy exactly what is in the field: the press does not move focus, so the typed text is not replaced by
  // the saved link.
  copy.extraSettingsEl.addEventListener('pointerdown', (evt) => evt.preventDefault());
  copy.onClick(() => {
    const url = normalizeLink(input.getValue());
    if (held || url === null || !isLinkUrl(url)) return;
    void (async () => {
      try {
        await navigator.clipboard.writeText(url);
        new Notice(t('linkCopied'));
      } catch (error) {
        console.error('Buba: link not copied', error);
        new Notice(t('linkCopyFailed'));
      }
    })();
  });
  const press = button.extraSettingsEl;
  press.addEventListener('pointerdown', () => {
    pressing = true;
  });
  // The press ended. This element listener runs after Obsidian's button handler, which does not call
  // `onClick` on a disabled button, so the hold is cleared then too.
  press.addEventListener('click', () => {
    pressing = false;
    if (!held) return;
    held = false;
    sync();
  });

  const off = storage.onChange((changed) => {
    if (closed || !changed.includes(file.path) || inputEl.ownerDocument.activeElement === inputEl) return;
    input.setValue(saved());
    sync();
  });
  return () => {
    closed = true;
    off();
    // Cleanup before a redraw: if the field has focus and holds something other than the saved link, the
    // typed text and selection go into the handoff. No saving or warning here: the field is only being
    // redrawn, not left.
    if (inputEl.ownerDocument.activeElement !== inputEl || inputEl.value === saved()) return;
    const kept: Typed = {
      file,
      value: inputEl.value,
      start: inputEl.selectionStart,
      end: inputEl.selectionEnd,
      direction: inputEl.selectionDirection,
    };
    handoff.typed = kept;
    // The redraw follows right away, in the same task; a handoff not picked up (panel closed, file gone) does
    // not survive to another draw.
    queueMicrotask(() => {
      if (handoff.typed === kept) handoff.typed = null;
    });
  };
}
