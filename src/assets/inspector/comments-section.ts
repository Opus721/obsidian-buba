// "Comments" panel section (`buba-comments`, order 50). For one file: its text comments with a short date
// (the full one as a tooltip), an input field and a round "Add comment" button; the cross deletes a comment,
// the round check on the left marks it done (done comments are grey, at the bottom, under a collapsed "Done
// (N)" row). For several files: only a note. The button shares the field's row while the text fits left of
// it, otherwise it goes under the field; the field grows by whole lines up to `MAX_LINES` and `PANEL_SHARE`
// of the panel, then scrolls. Comments live in journals in the `__buba-data/` folder (and the legacy
// `Buba/`), so nothing appears next to the file. Text is only ever text, never HTML.
import {
  ButtonComponent,
  ExtraButtonComponent,
  Notice,
  Scope,
  setIcon,
  TextAreaComponent,
  type Plugin,
} from 'obsidian';
import { t } from '../../core/i18n/dict/inspector.ts';
import type { BubaStorage, CommentDone } from '../../core/storage/types.ts';
import { iconButton } from '../../platform/icon-button.ts';
import { obsidianLanguage } from '../../platform/locale.ts';
import { settingsOf } from '../../platform/settings.ts';
import {
  COMMENT_MAX,
  commentGroups,
  commentRows,
  doneTitle,
  leftNote,
  pasteOverflows,
  sendComment,
  type CommentField,
  type CommentRow,
} from './comments.ts';
import type { InspectorSection } from './sections.ts';
import './comments.css';

export const COMMENTS_SECTION_ID = 'buba-comments';

/** Field lines before scrolling; the field does not grow further. Long texts need room, on a phone too. */
const MAX_LINES = 25;
/**
 * Share of the file panel's visible height the field does not grow beyond: "Send" and the counter stay below
 * it.
 */
const PANEL_SHARE = 3 / 4;

/**
 * Storage is the plugin's `storage` field: read on every draw, since it opens after load. The plugin's
 * storage always supports the "done" mark; a fake storage in tests may not, and then there is no check.
 */
type CommentStorage = BubaStorage & Partial<CommentDone>;
function storageOf(plugin: Plugin): CommentStorage | undefined {
  return (plugin as Plugin & { storage?: CommentStorage }).storage;
}

export function commentsSection(plugin: Plugin): InspectorSection {
  // The done group stays expanded while the same file is shown: redrawing it keeps it open, another file or
  // coming back to this one collapses it. Not remembered, local storage is not touched.
  const fold: DoneFold = { path: null, open: false };
  return {
    id: COMMENTS_SECTION_ID,
    order: 50,
    render(el, paths) {
      el.createDiv({ cls: 'buba-comments-title', text: t('commentsTitle') });
      const storage = storageOf(plugin);
      const [path] = paths;
      if (fold.path !== (paths.length === 1 ? path : null)) Object.assign(fold, { path: null, open: false });
      if (paths.length !== 1 || path === undefined) {
        el.createDiv({ cls: 'buba-comments-note', text: t('commentsOneFile') });
        return;
      }
      if (!storage) {
        el.createDiv({ cls: 'buba-comments-note', text: t('storageClosed') });
        return;
      }
      fold.path = path;
      return renderComments(plugin, el, storage, path, fold);
    },
  };
}

/** The done group is expanded (`open`) for file `path`. */
interface DoneFold {
  path: string | null;
  open: boolean;
}

function renderComments(
  plugin: Plugin,
  el: HTMLElement,
  storage: CommentStorage,
  path: string,
  fold: DoneFold,
): () => void {
  const { app } = plugin;
  const list = el.createDiv({ cls: 'buba-comments-list' });
  const row = (comment: CommentRow): void => {
    const item = list.createDiv({ cls: comment.done ? 'buba-comment is-done' : 'buba-comment' });
    // The check is Obsidian's task checkbox (`- [ ]` in a note, `task-list-item-checkbox`), made round in
    // comments.css. A click writes the new mark; the storage event redraws the list, and a failure redraws
    // with the old mark.
    if (storage.setCommentDone) {
      const set = storage.setCommentDone.bind(storage);
      const box = item.createEl('input', {
        cls: 'task-list-item-checkbox buba-comment-check',
        attr: {
          type: 'checkbox',
          'aria-label': comment.done ? t('markNotDone') : t('markDone'),
        },
      });
      box.checked = comment.done;
      box.addEventListener('click', () => void check(set, comment.id, !comment.done));
    }
    const body = item.createDiv({ cls: 'buba-comment-body' });
    body.createDiv({ cls: 'buba-comment-text', text: comment.text });
    // Full date and time as Obsidian's hover tooltip (`aria-label`, as for buttons with `setTooltip`).
    body.createDiv({ cls: 'buba-comment-meta', text: comment.meta, attr: { 'aria-label': comment.full } });
    const drop = new ExtraButtonComponent(item)
      .setIcon('x')
      .setTooltip(t('deleteComment'))
      .onClick(() => void remove(storage, path, comment.id));
    iconButton(drop.extraSettingsEl, 'medium');
  };
  // Done comments sit under a "Done (N)" row with the arrow of an Obsidian collapsible section
  // (`collapse-icon`, `is-collapsed`, like a folder in the tree); collapsed when a file is opened. Without
  // done comments there is no row.
  const draw = (): void => {
    list.empty();
    // Date and time format are Buba settings; changing them redraws the panel (index.ts).
    const { open, done } = commentGroups(
      commentRows(storage.get(path).comments, obsidianLanguage(), undefined, settingsOf(plugin)),
    );
    for (const comment of open) row(comment);
    if (!done.length) return;
    const expanded = fold.open;
    const toggle = list.createDiv({
      cls: 'buba-comments-done-toggle',
      attr: { role: 'button', tabindex: 0, 'aria-expanded': String(expanded) },
    });
    const arrow = toggle.createDiv({ cls: expanded ? 'collapse-icon' : 'collapse-icon is-collapsed' });
    setIcon(arrow, 'right-triangle');
    toggle.createSpan({ cls: 'buba-comments-done-title', text: doneTitle(done.length) });
    const flip = (): void => {
      fold.open = !expanded;
      draw();
    };
    toggle.addEventListener('click', flip);
    toggle.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' && evt.key !== ' ') return;
      evt.preventDefault();
      flip();
    });
    if (expanded) for (const comment of done) row(comment);
  };

  const form = el.createDiv({ cls: 'buba-comments-new' });
  const input = new TextAreaComponent(form).setPlaceholder(t('commentPlaceholder'));
  input.inputEl.rows = 1;
  // Length limit: the field accepts no more and trims a paste itself (`maxLength`), with a notice about the
  // cut. When little is left, a quiet counter shows under the field before the button: in the "under the
  // field" layout it is left of the button.
  input.inputEl.maxLength = COMMENT_MAX;
  const left = form.createDiv({ cls: 'buba-comments-left' });
  left.hidden = true;
  input.inputEl.addEventListener('paste', (evt) => {
    const field = input.inputEl;
    const selected = (field.selectionEnd ?? 0) - (field.selectionStart ?? 0);
    if (pasteOverflows(field.value.length, selected, evt.clipboardData?.getData('text') ?? ''))
      new Notice(t('commentPasteCut', { max: COMMENT_MAX }));
  });
  // `closed`: the section redrew and the field is off screen. The field is passed to `sendComment` as the
  // same object every time, so it can tell that a write of this field is in flight and leave text typed
  // meanwhile alone.
  let closed = false;
  const field: CommentField = {
    get: () => input.getValue(),
    set: (text) => {
      input.setValue(text);
      layout();
    },
  };
  const add = async (): Promise<void> => {
    if (closed) return;
    try {
      await sendComment(field, (text) => storage.addComment(path, text));
    } catch (error) {
      console.error('Buba: comment not added', error);
      new Notice(t('commentAddFailed'));
    }
  };
  // The key scope catches Enter before the open note's Obsidian commands. Shift+Enter inserts a line break;
  // IME composition commits and auto-repeat of a held key do not send the comment.
  let composing = false;
  input.inputEl.addEventListener('compositionstart', () => {
    composing = true;
  });
  input.inputEl.addEventListener('compositionend', () => {
    composing = false;
  });
  const scope = new Scope(app.scope);
  scope.register(null, 'Enter', (evt) => {
    if (evt.shiftKey || evt.isComposing || composing || evt.keyCode === 229) return;
    evt.preventDefault();
    if (!evt.repeat) void add();
    return false;
  });
  input.inputEl.addEventListener('focus', () => app.keymap.pushScope(scope));
  input.inputEl.addEventListener('blur', () => app.keymap.popScope(scope));
  // Round icon button: icon and tooltip are the standard `setIcon` and `setTooltip` of an Obsidian button;
  // fill and icon color are those of the filled Buba icon button, like "+ Tag"; the size is in comments.css.
  const send = new ButtonComponent(form)
    .setIcon('arrow-up')
    .setTooltip(t('addComment'))
    .setClass('buba-comment-send')
    .onClick(() => void add());
  iconButton(send.buttonEl, 'filled');
  const layout = (): void => {
    if (closed) return;
    const note = leftNote(input.getValue().length);
    left.setText(note ?? '');
    left.hidden = note === null;
    layoutForm(form, input.inputEl, send.buttonEl);
  };
  input.inputEl.addEventListener('input', layout);
  // The panel width changed, so the text may no longer fit left of the button. The observer belongs to the
  // field's window: the panel can be in an Obsidian popout window; the first notification arrives once the
  // field is laid out. Layout runs in the next frame: changing the field height inside the notification would
  // cause "ResizeObserver loop completed with undelivered notifications".
  const win = form.win as (Window & typeof globalThis) | undefined;
  let width = -1;
  const resize = win?.ResizeObserver
    ? new win.ResizeObserver(([entry]) => {
        const next = entry?.contentRect.width ?? -1;
        if (next === width) return;
        width = next;
        win.requestAnimationFrame(layout);
      })
    : null;
  resize?.observe(form);

  const check = async (set: CommentDone['setCommentDone'], id: string, done: boolean): Promise<void> => {
    try {
      await set(path, id, done);
    } catch (error) {
      console.error('Buba: comment mark not saved', error);
      new Notice(t('commentMarkFailed'));
      if (!closed) draw();
    }
  };

  draw();
  const off = storage.onChange((changed) => {
    if (!closed && changed.includes(path)) draw();
  });
  return () => {
    closed = true;
    resize?.disconnect();
    off();
    // The section redrew while the field had focus: the blur may never come.
    app.keymap.popScope(scope);
  };
}

async function remove(storage: BubaStorage, path: string, id: string): Promise<void> {
  try {
    await storage.removeComment(path, id);
  } catch (error) {
    console.error('Buba: comment not deleted', error);
    new Notice(t('commentDeleteFailed'));
  }
}

/**
 * Lays out the field and the "Send" button: text with a line break, or too long for one line left of the
 * button, gets `is-wrapped` (field at full width, button below it, comments.css). The field height is its
 * text lines (`rows`, whole-pixel lines) up to `MAX_LINES` and `PANEL_SHARE` of the file panel's visible
 * height (`.buba-inspector`), then it scrolls. A button on the field's row is centered on its first line,
 * shifted down by whole pixels. The line count comes from the `scrollHeight` of the field at one row. A field
 * not in the document (section redrawn, not yet inserted) has nothing to measure.
 */
function layoutForm(form: HTMLElement, field: HTMLTextAreaElement, button: HTMLElement): void {
  if (!field.isConnected) return;
  const lines = (): number => {
    field.rows = 1;
    const style = field.win.getComputedStyle(field);
    const line = parseFloat(style.lineHeight);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    return line > 0 ? Math.max(1, Math.round((field.scrollHeight - padding) / line)) : 1;
  };
  field.setCssStyles({ overflowY: 'hidden' });
  form.removeClass('is-wrapped');
  const wrapped = field.value.includes('\n') || lines() > 1;
  form.toggleClass('is-wrapped', wrapped);
  const count = wrapped ? lines() : 1;
  const line = parseFloat(field.win.getComputedStyle(field).lineHeight);
  const panel = field.closest('.buba-inspector')?.clientHeight ?? 0;
  const limit =
    panel > 0 && line > 0
      ? Math.max(1, Math.min(MAX_LINES, Math.floor((panel * PANEL_SHARE) / line)))
      : MAX_LINES;
  field.rows = Math.min(count, limit);
  field.setCssStyles({ overflowY: count > limit ? 'auto' : 'hidden' });
  const offset = wrapped ? 0 : Math.max(0, Math.floor((field.offsetHeight - button.offsetHeight) / 2));
  button.setCssStyles({ marginTop: offset ? `${offset}px` : '' });
}
