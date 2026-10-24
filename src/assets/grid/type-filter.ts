// "File type" above the grid: a window with checkboxes for the types in the open place, a "PSD · 12 of 340"
// caption in the path row, and a notice about new files the filter hid. The grid view (view.ts) keeps the
// choice in its memory; the window changes it only through `set`. The window is an Obsidian `Modal`, like
// "Tile size…" (toolbar.ts); the checkboxes are `input[type=checkbox]`, which Obsidian styles itself, as in
// the Bases properties list. Type labels come from file names, so they are text only.
import { Modal, Notice, Platform, SearchComponent, ToggleComponent, type App } from 'obsidian';
import { t } from '../../core/i18n/dict/grid.ts';
import { matchTypes, typeCaption, typeLabel, type TypeCount } from '../../core/filter/file-types.ts';
import './type-filter.css';

// The empty result uses Obsidian's wording (`setting.third-party-plugin.label-no-results-found`): key
// `noTypesFound`.

/** What the toolbar knows about the view's filter; a new object on every draw. */
export interface TypeFilter {
  /** Checked types; empty means all. */
  readonly selected: ReadonlySet<string>;
  /** Kept for the current tab only; by default the filter is cleared on moving to another place. */
  readonly keep: boolean;
  setKeep(keep: boolean): void;
  /** How many files are shown and how many the place has; `null` without a filter. */
  readonly tally: { readonly shown: number; readonly total: number } | null;
  /** How many new files of the place the filter hid since the last draw. */
  readonly hiddenNew: number;
  /** Types in the open place with their file counts; one pass over the place per call. */
  counts(): TypeCount[];
  /** Sets the choice: the view redraws the grid and the toolbar. */
  set(types: ReadonlySet<string>): void;
}

/**
 * "File type" window: "All types" with the count of all files in the place, then each type with its count.
 * "All types" is checked while the choice is empty; checking it clears the choice. Checking a type shows only
 * checked types; unchecking the last one shows all again. The choice applies at once and the window stays
 * open, like the slider of the tile size window.
 *
 * Above the list is a "Find type" field (`SearchComponent`, like the search above the checkboxes of the Bases
 * "Properties" menu): each keystroke keeps the types whose label contains the query (`matchTypes`). Rows are
 * not recreated, so checks on hidden types stay and apply; "All types" is a reset, not a type, and is always
 * visible. With no match, "No results found." shows as Obsidian's empty suggestion row. Every opening starts
 * with an empty field and the full list. The field gets focus on desktop only: on a phone tapping the field
 * brings up the keyboard, as with Obsidian's `autoSelect` (its physical keyboard check is not public API,
 * hence `Platform.isMobile`). Clicking or tapping a row does not move focus (`row`).
 */
export function openTypeWindow(app: App, filter: TypeFilter): void {
  const modal = new Modal(app).setTitle(t('fileType'));
  modal.modalEl.addClass('buba-types-modal');
  const keep = modal.contentEl.createDiv({ cls: 'buba-types-keep' });
  keep.createSpan({ text: t('keepOnNavigate') });
  new ToggleComponent(keep)
    .setValue(filter.keep)
    .setTooltip(t('keepOnNavigate'))
    .onChange((value) => filter.setKeep(value));
  const search = new SearchComponent(modal.contentEl).setPlaceholder(t('findType'));
  const counts = filter.counts();
  const selected = new Set(filter.selected);
  const list = modal.contentEl.createDiv({ cls: 'buba-types' });
  const total = counts.reduce((sum, { count }) => sum + count, 0);
  const all = row(list, t('allTypes'), total);
  all.label.addClass('mod-all');
  const rows = counts.map(({ type, count }) => ({ type, ...row(list, typeLabel(type), count) }));
  const nothing = list.createDiv({ cls: 'suggestion-empty', text: t('noTypesFound') });
  const types = rows.map(({ type }) => type);
  const find = (query: string): void => {
    const found = new Set(matchTypes(types, query));
    for (const { type, label } of rows) label.toggle(found.has(type));
    nothing.toggle(found.size === 0 && query.trim() !== '');
  };
  search.onChange(find);
  find('');
  const sync = (): void => {
    all.box.checked = selected.size === 0;
    for (const { type, box } of rows) box.checked = selected.has(type);
  };
  all.box.addEventListener('change', () => {
    if (selected.size > 0) {
      selected.clear();
      filter.set(new Set(selected));
    }
    sync();
  });
  for (const { type, box } of rows) {
    box.addEventListener('change', () => {
      if (box.checked) selected.add(type);
      else selected.delete(type);
      filter.set(new Set(selected));
      sync();
    });
  }
  sync();
  modal.open();
  if (!Platform.isMobile) search.inputEl.focus();
}

/**
 * A window row: the whole row is the checkbox label, a tap anywhere on it toggles the box. The row does not
 * take focus, like the items of the Bases "Properties" menu (`mousedown` → `preventDefault`): on desktop
 * typing after a click goes into "Find type", on a phone a row tap neither raises nor hides the keyboard. A
 * label itself forwards a click to its checkbox and focuses it (Chromium), so a click off the checkbox is
 * cancelled and passed to the box.
 */
function row(list: HTMLElement, name: string, count: number): { label: HTMLElement; box: HTMLInputElement } {
  const label = list.createEl('label', { cls: 'buba-types-row' });
  const box = label.createEl('input', { attr: { type: 'checkbox' } });
  label.createSpan({ cls: 'buba-types-name', text: name });
  label.createSpan({ cls: 'buba-types-count', text: String(count) });
  label.addEventListener('mousedown', (event) => event.preventDefault());
  label.addEventListener('click', (event) => {
    if (event.target === box) return;
    event.preventDefault();
    box.click();
  });
  return { label, box };
}

/** Filter caption in the path row: "PSD · 12 of 340" (types and counts) plus a separate empty-result note. */
export interface TypeNote {
  /** Types and counts, grouped with the place name. */
  readonly el: HTMLElement;
  readonly names: HTMLElement;
  readonly tally: HTMLElement;
  /** Empty result note, after the group; shrinks first. */
  readonly empty: HTMLElement;
}

/**
 * Filter caption: types and counts go into `title`, the group with the place name; the note goes into `path`,
 * after the group. Types and counts are separate parts: long types shrink with an ellipsis, counts never do
 * (type-filter.css).
 */
export function createTypeNote(title: HTMLElement, path: HTMLElement): TypeNote {
  const el = title.createDiv({ cls: 'buba-grid-types' });
  const names = el.createSpan({ cls: 'buba-grid-types-names' });
  const tally = el.createSpan({ cls: 'buba-grid-types-tally' });
  const empty = path.createDiv({ cls: 'buba-grid-types-empty' });
  return { el, names, tally, empty };
}

/**
 * Filter caption in the path row: when on, "PSD · 12 of 340" and, if nothing is shown, the note, which
 * shrinks first on a narrow screen while the counts stay visible; when off, no caption.
 */
export function renderTypeNote(note: TypeNote, filter: TypeFilter): void {
  const { tally } = filter;
  const caption = tally && typeCaption(filter.selected, tally.shown, tally.total);
  note.el.toggle(caption !== null);
  note.names.setText(caption?.names ?? '');
  note.tally.setText(caption?.tally ?? '');
  note.empty.toggle(!!caption?.tail);
  note.empty.setText(caption?.tail ?? '');
}

/** One notice per wave of hidden new files: while the last one is on screen, its count grows. */
const hiddenNotices = new WeakMap<HTMLElement, { notice: Notice; count: number }>();

const hiddenText = (count: number): string => t('hiddenNewFiles', { count });

/**
 * New files of the place hidden by the filter get an Obsidian notice; `el` is the view's toolbar, so each tab
 * has its own notice. A grid that is not on screen (a background tab, hidden by Obsidian with
 * `display: none`) stays quiet: a file pasted into a note is no reason to notify about a grid nobody sees;
 * its caption will say "12 of 341" when the user comes back.
 */
export function noticeHidden(el: HTMLElement, count: number): void {
  if (count <= 0 || !el.isShown()) return;
  const last = hiddenNotices.get(el);
  if (last && last.notice.containerEl?.isConnected) {
    last.count += count;
    last.notice.setMessage(hiddenText(last.count));
    return;
  }
  hiddenNotices.set(el, { notice: new Notice(hiddenText(count)), count });
}
