// "File" panel section (`buba-file`, order 20): for one file the name with rename, the full disk path on one line with
// a "Copy path" button, size, type and dates; for several files their count and total size. Renaming goes
// only through `fileManager.renameFile`, so Obsidian updates links to the file. Name, path and type are text
// only.
import { Notice, Platform, TextAreaComponent, type App, type TFile } from 'obsidian';
// The size of one file and the total of several follow one rule, that of Windows Explorer's "Properties"; it
// lives in the core so `node --test` checks it without `obsidian`.
import { t } from '../../core/i18n/dict/inspector.ts';
import { DEFAULT_DATE_LOOK, formatDateTime, type DateLook } from '../../core/inspector/date.ts';
import { formatSize } from '../../core/inspector/size.ts';
import { diskPath } from '../../platform/disk-path.ts';
import { renameRecorded } from '../../platform/files/undo.ts';
import { obsidianLanguage } from '../../platform/locale.ts';
import { countFiles, fileType, nameEdited, nameProblem, splitName } from './format.ts';
import type { InspectorSection } from './sections.ts';

export const FILE_SECTION_ID = 'buba-file';

/**
 * What sits to the right of a single file's path: the "Copy path" button (`path-copy.ts`). The panel
 * (`index.ts`) provides it, so the section imports no Obsidian buttons and the undo key set can draw it
 * without them.
 */
export type PathTools = (el: HTMLElement, path: string) => void;

/**
 * Text typed in the name field while the panel redraws: the section cleanup hands it to the draw of the same
 * file (the same `TFile`, which survives edits and renames).
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

/** `look` is the Buba "Date format" and "Time format" settings at draw time; defaults if absent (tests). */
export function fileSection(
  app: App,
  pathTools?: PathTools,
  look: () => Readonly<DateLook> = () => DEFAULT_DATE_LOOK,
): InspectorSection {
  const handoff: Handoff = { typed: null };
  return {
    id: FILE_SECTION_ID,
    order: 20,
    render(el, paths) {
      const files = paths.map((path) => app.vault.getFileByPath(path)).filter((file) => file !== null);
      const [first] = files;
      // Typed text waits only for the draw of the same file in this redraw; another file does not get it.
      const typed = handoff.typed;
      handoff.typed = null;
      if (!first) return;
      if (files.length === 1) return renderOne(app, el, first, handoff, typed, pathTools, look());
      renderMany(el, files);
    },
  };
}

function renderOne(
  app: App,
  el: HTMLElement,
  file: TFile,
  handoff: Handoff,
  typed: Typed | null,
  pathTools: PathTools | undefined,
  look: Readonly<DateLook>,
): () => void {
  const { base, ext } = splitName(file.name);
  const nameEl = el.createDiv({ cls: 'buba-inspector-name' });
  // A long name wraps instead of being cut: the field grows by whole lines (`fitName`), so the whole name is
  // readable in the panel on a computer and on a phone, like Obsidian's inline title.
  const input = new TextAreaComponent(nameEl).setValue(base);
  input.inputEl.rows = 1;
  input.inputEl.spellcheck = false;
  if (ext) nameEl.createSpan({ cls: 'buba-inspector-ext', text: `.${ext}` });
  // The panel redrew while another name was being typed: the typed text, focus and selection go back into the
  // field.
  if (typed?.file === file) {
    input.setValue(typed.value);
    input.inputEl.focus();
    input.inputEl.setSelectionRange(typed.start, typed.end, typed.direction ?? undefined);
  }

  // `busy`: a rename is in progress; `closed`: the panel redrew and this field is no longer on screen.
  let busy = false;
  let closed = false;
  const commit = async (): Promise<void> => {
    if (busy || closed) return;
    const current = splitName(file.name).base;
    const next = input.getValue().trim();
    if (next === current) {
      input.setValue(current);
      return;
    }
    const problem = nameProblem(next);
    if (problem) {
      new Notice(problem);
      input.setValue(current);
      return;
    }
    const folder = file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : '';
    const target = `${folder}${next}${ext ? `.${ext}` : ''}`;
    if (app.vault.getAbstractFileByPath(target)) {
      new Notice(t('nameTaken'));
      input.setValue(current);
      return;
    }
    busy = true;
    try {
      await renameRecorded(app, file, target);
    } catch (error) {
      new Notice(t('renameFailed', { error: error instanceof Error ? error.message : String(error) }));
      if (!closed) input.setValue(splitName(file.name).base);
    } finally {
      busy = false;
    }
  };
  // Enter moves focus off the field, and leaving the field renames: one save point for both paths. Escape, as
  // in Obsidian's rename: the old name goes back into the field, focus leaves, nothing to rename.
  input.inputEl.addEventListener('keydown', (evt) => {
    if (evt.isComposing || (evt.key !== 'Enter' && evt.key !== 'Escape')) return;
    evt.preventDefault();
    if (evt.key === 'Escape') {
      evt.stopPropagation();
      input.setValue(splitName(file.name).base);
    }
    input.inputEl.blur();
  });
  input.inputEl.addEventListener('blur', () => void commit());
  // A name has no line breaks: a pasted one becomes spaces as it arrives.
  input.inputEl.addEventListener('input', () => {
    const field = input.inputEl;
    if (/[\r\n]/.test(field.value)) {
      const { selectionStart, selectionEnd } = field;
      field.value = field.value.replace(/\r\n|[\r\n]/g, ' ');
      field.setSelectionRange(selectionStart, selectionEnd);
    }
    fitName(field);
  });
  // The panel width changed, so the name may wrap to another number of lines. The observer belongs to the
  // field's window (the panel can be in a popout); fitting runs in the next frame, as in comments-section.ts.
  const win = nameEl.win as typeof window | undefined;
  let width = -1;
  const resize = win?.ResizeObserver
    ? new win.ResizeObserver(([entry]) => {
        const next = entry?.contentRect.width ?? -1;
        if (next === width) return;
        width = next;
        win.requestAnimationFrame(() => {
          if (!closed) fitName(input.inputEl);
        });
      })
    : null;
  resize?.observe(nameEl);

  const rows = el.createDiv({ cls: 'buba-inspector-rows' });
  pathRow(rows, diskPath(app, file.path), pathTools);
  row(rows, t('labelSize'), formatSize(file.stat.size, obsidianLanguage()));
  row(rows, t('labelType'), fileType(ext));
  row(rows, t('labelCreated'), formatDateTime(file.stat.ctime, obsidianLanguage(), look));
  row(rows, t('labelModified'), formatDateTime(file.stat.mtime, obsidianLanguage(), look));
  return () => {
    closed = true;
    resize?.disconnect();
    // Cleanup before a redraw: if the field has focus and the user edited it (it differs from what was
    // drawn), the typed text and selection go into the handoff. An unedited field carries nothing: if the
    // file was renamed elsewhere, the next draw shows the new name and leaving the field reverts nothing.
    const { inputEl } = input;
    if (inputEl.ownerDocument.activeElement !== inputEl || !nameEdited(base, inputEl.value)) return;
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

/** Most lines the name field grows to; a longer name scrolls inside the field. */
const NAME_MAX_LINES = 5;

/**
 * Name field height: as many whole lines as the name takes at the field's width, up to `NAME_MAX_LINES`, then
 * it scrolls. The count comes from the `scrollHeight` of the field at one row, as for the comment field. A
 * taller field can make the panel scroll, and its scrollbar narrows the field so the name takes one more
 * line: then the count is taken again at the new height. A field not in the document has nothing to measure.
 */
function fitName(field: HTMLTextAreaElement): void {
  if (!field.isConnected) return;
  const style = field.win.getComputedStyle(field);
  const line = parseFloat(style.lineHeight);
  if (!(line > 0)) return;
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const lines = (): number => Math.max(1, Math.round((field.scrollHeight - padding) / line));
  field.setCssStyles({ overflowY: 'hidden' });
  field.rows = 1;
  let count = lines();
  field.rows = Math.min(count, NAME_MAX_LINES);
  for (let i = 0; i < 2 && count < NAME_MAX_LINES && field.scrollHeight > field.clientHeight; i++) {
    count = lines();
    field.rows = Math.min(count, NAME_MAX_LINES);
  }
  field.setCssStyles({ overflowY: count > NAME_MAX_LINES ? 'auto' : 'hidden' });
}

function renderMany(el: HTMLElement, files: readonly TFile[]): void {
  el.createDiv({ cls: 'buba-inspector-count', text: countFiles(files.length) });
  const rows = el.createDiv({ cls: 'buba-inspector-rows' });
  const size = files.reduce((sum, file) => sum + file.stat.size, 0);
  row(rows, t('labelSize'), formatSize(size, obsidianLanguage()));
}

/**
 * The path on one line with "…" at the end (inspector.css); the full path is Obsidian's hover tooltip, which
 * any element with `aria-label` gets, and `setTooltip` sets only that (Obsidian 1.14). `tools` go on the
 * right.
 */
function pathRow(rows: HTMLElement, path: string, tools: PathTools | undefined): void {
  rows.createDiv({ cls: 'buba-inspector-label', text: t('labelPath') });
  const value = rows.createDiv({ cls: 'buba-inspector-value buba-inspector-path' });
  const text = value.createDiv({ cls: 'buba-inspector-path-text', text: path, attr: { 'aria-label': path } });
  if (Platform.isMobile) {
    text.setAttr('role', 'button');
    text.setAttr('tabindex', '0');
    text.setAttr('aria-expanded', 'false');
    let expanded = false;
    const toggle = (): void => {
      expanded = !expanded;
      text.toggleClass('is-expanded', expanded);
      text.setAttr('aria-expanded', String(expanded));
    };
    text.addEventListener('click', toggle);
    text.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' && evt.key !== ' ') return;
      evt.preventDefault();
      toggle();
    });
  }
  tools?.(value, path);
}

function row(rows: HTMLElement, label: string, value: string): void {
  rows.createDiv({ cls: 'buba-inspector-label', text: label });
  // No `aria-label`: Obsidian would show it as a tooltip repeating the value, which wraps and is always whole.
  rows.createDiv({ cls: 'buba-inspector-value buba-inspector-fact', text: value });
}
