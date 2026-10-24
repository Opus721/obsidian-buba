// "Generation" file panel section (`buba-generation`, order 47, between the link and comments): what made
// the one shown file. "Copy for agent" sits on the section heading, the same place for every file and folded
// too; then the prompt with reference tags, clamped to six lines with "Show all", "Copy" and "Open in window"
// on its label; the references; one list of model, provider, kind, every parameter, the cost, and when and by
// whom. A value stays on one line: cut with "…", whole in the hover tooltip, a tap unfolds it on phone and
// tablet, like the path. Shown only for a file with a passport. Everything from the passport is text
// (`createEl`, `createSpan`); `hidden` is never drawn and goes only to "Copy for agent".
import { Platform, setIcon, type Plugin, type TAbstractFile } from 'obsidian';
import { agentPassport } from '../core/generation/agent.ts';
import { promptPieces } from '../core/generation/mentions.ts';
import { kindLabel, paramRows, roleIcon, roleLabel } from '../core/generation/params.ts';
import { refSlots, type RefSlot } from '../core/generation/refs.ts';
import { t } from '../core/i18n/dict/generation.ts';
import { formatDateTime } from '../core/inspector/date.ts';
import { GENERATION_SECTION, type PanelSection } from '../core/inspector/events.ts';
import type { Passport } from '../core/storage/passport.ts';
import { iconButton } from '../platform/icon-button.ts';
import { obsidianLanguage } from '../platform/locale.ts';
import { refLocator } from '../platform/passport-write.ts';
import { passportStorage } from '../platform/passports.ts';
import { settingsOf } from '../platform/settings.ts';
import { foldHeading } from './fold.ts';
import { PromptModal } from './prompt-modal.ts';
import { copy, ThumbSet, type ThumbFile } from './thumbs.ts';

export const GENERATION_SECTION_ID = GENERATION_SECTION;
const FOLD_KEY = 'buba-generation-folded';
/** Prompt lines shown before "Show all". */
export const PROMPT_LINES = 6;

type TextField = 'prompt' | 'negativePrompt' | 'lyrics';
const TEXT_FIELDS: readonly TextField[] = ['prompt', 'negativePrompt', 'lyrics'];
const COPIED: Record<TextField, 'promptCopied' | 'negativeCopied' | 'lyricsCopied'> = {
  prompt: 'promptCopied',
  negativePrompt: 'negativeCopied',
  lyrics: 'lyricsCopied',
};

export function generationSection(plugin: Plugin): PanelSection {
  const { app } = plugin;
  /** Expanded text blocks; reset when another file is shown, like "Done" in comments. */
  const expanded = new Set<TextField>();
  let shown: string | null = null;
  /** Redraw of the drawn section when a file it shows changes in the vault. */
  const watchers = new Set<(file: TAbstractFile, oldPath?: string) => void>();
  const touched = (file: TAbstractFile, oldPath?: string): void => {
    for (const watch of [...watchers]) watch(file, oldPath);
  };
  plugin.registerEvent(app.vault.on('create', touched));
  plugin.registerEvent(app.vault.on('delete', touched));
  plugin.registerEvent(app.vault.on('rename', touched));

  return {
    id: GENERATION_SECTION_ID,
    order: 47,
    render(el, paths) {
      const [only] = paths;
      const storage = passportStorage(plugin);
      if (only === undefined || paths.length > 1 || !storage) {
        el.hide();
        return;
      }
      if (only !== shown) expanded.clear();
      shown = only;
      const thumbs = new ThumbSet(plugin);
      /** Paths and names the drawn section depends on. */
      let names = new Set<string>();
      /** Undoes what a drawn passport set up outside its elements (the cell watcher). */
      const stops: (() => void)[] = [];
      const stop = (): void => {
        for (const each of stops.splice(0)) each();
      };
      const draw = (): void => {
        stop();
        thumbs.clear();
        el.empty();
        const passport = storage.passport(only);
        if (!passport) {
          el.hide();
          names = new Set();
          return;
        }
        el.show();
        names = drawPassport(plugin, el, only, passport, thumbs, expanded, draw, stops);
      };
      draw();
      const off = storage.onChange((changed) => {
        if (changed.some((each) => each === only || names.has(each))) draw();
      });
      const watch = (file: TAbstractFile, oldPath?: string): void => {
        if (names.has(file.path) || names.has(file.name) || (oldPath !== undefined && names.has(oldPath)))
          draw();
      };
      watchers.add(watch);
      return () => {
        off();
        watchers.delete(watch);
        thumbs.clear();
        stop();
      };
    },
  };
}

/**
 * Draws the passport; returns the reference paths and names whose vault changes redraw it. What must be undone
 * before the next draw goes to `stops`.
 */
function drawPassport(
  plugin: Plugin,
  el: HTMLElement,
  path: string,
  passport: Passport,
  thumbs: ThumbSet,
  expanded: Set<TextField>,
  redraw: () => void,
  stops: (() => void)[],
): Set<string> {
  const { app } = plugin;
  const names = new Set<string>();
  const { vault } = app;
  const forAgent = (): void => {
    const view = agentPassport(path, passport, refLocator(vault));
    void copy(JSON.stringify(view, null, 2), t('copiedForAgent'));
  };
  const folded = foldHeading(app, el, FOLD_KEY, t('sectionTitle'), passport.model, redraw, (tools) =>
    toolButton(tools, 'bot', t('copyForAgent'), forAgent),
  );
  if (folded) return names;
  const locate = refLocator(vault);

  const slots = refSlots(passport);
  const items = new Map<RefSlot, ThumbFile>();
  for (const slot of slots) {
    const now = locate(slot.ref);
    const file = now === null ? null : vault.getFileByPath(now);
    const name = slot.ref.fp?.name ?? slot.ref.path.slice(slot.ref.path.lastIndexOf('/') + 1);
    names.add(slot.ref.path).add(name);
    if (file) names.add(file.path);
    items.set(slot, thumbs.add({ file, path: slot.ref.path, name, media: slot.media }));
  }
  // The badge of a known role is an icon, so the hover text names the role next to the tag: `Audio1 · voice`.
  const label = (slot: RefSlot): string =>
    [slot.tag, slot.badge ? roleLabel(slot.badge) : ''].filter(Boolean).join(' · ') ||
    roleLabel(slot.ref.role);
  const tip = (slot: RefSlot, item: ThumbFile): string =>
    item.file
      ? t('refTip', { tag: label(slot), name: item.file.name })
      : t('missingTip', { tag: label(slot), name: item.name });

  for (const field of TEXT_FIELDS) {
    const text = passport[field];
    if (text === undefined) continue;
    const title = t(field);
    const head = el.createDiv({ cls: 'buba-gen-label' });
    head.createSpan({ cls: 'buba-gen-label-text', text: title });
    toolButton(head, 'copy', t('copy'), () => void copy(text, t(COPIED[field])));
    toolButton(head, 'maximize-2', t('openInWindow'), () =>
      new PromptModal(app, title, text, t(COPIED[field])).open(),
    );

    const box = el.createDiv({ cls: 'buba-gen-text' });
    const body = box.createDiv({ cls: 'buba-gen-text-body' });
    const open = expanded.has(field);
    if (!open) body.addClass('is-clamped');
    if (field === 'lyrics') body.setText(text);
    else
      for (const piece of promptPieces(text, slots)) {
        const item = piece.slot && items.get(piece.slot);
        if (piece.slot && item) thumbs.mention(body, item, piece.text, tip(piece.slot, item));
        else body.appendText(piece.text);
      }
    const more = el.createEl('button', {
      cls: 'buba-gen-more',
      text: open ? t('showLess') : t('showAll'),
      attr: { type: 'button' },
    });
    more.addEventListener('click', () => {
      if (expanded.has(field)) expanded.delete(field);
      else expanded.add(field);
      redraw();
    });
    // "Show all" only when the text is cut; a hidden panel measures zero and keeps the button.
    if (!open)
      window.requestAnimationFrame(() => {
        if (body.clientHeight > 0 && body.scrollHeight <= body.clientHeight + 1) more.hide();
      });
  }

  if (slots.length) {
    el.createDiv({ cls: 'buba-gen-label' }).createSpan({
      cls: 'buba-gen-label-text',
      text: t('refsTitle', { count: slots.length }),
    });
    const grid = el.createDiv({ cls: 'buba-gen-thumbs' });
    for (const slot of slots) {
      const item = items.get(slot);
      if (!item) continue;
      const role = slot.badge ? { label: roleLabel(slot.badge), icon: roleIcon(slot.badge) } : null;
      thumbs.thumb(grid, item, tip(slot, item), role);
    }
  }

  const date = formatDateTime(Date.parse(passport.createdAt), obsidianLanguage(), settingsOf(plugin));
  const rows = [
    { label: t('rowModel'), value: passport.model },
    { label: t('rowProvider'), value: passport.provider },
    { label: t('rowKind'), value: kindLabel(passport.kind) },
    ...paramRows(passport),
    { label: t('rowCreated'), value: date },
    ...(passport.by ? [{ label: t('rowBy'), value: passport.by }] : []),
  ];
  const table = el.createDiv({ cls: 'buba-inspector-rows buba-gen-params' });
  const cells: [HTMLElement, string][] = [];
  for (const row of rows) {
    cells.push([oneLine(table.createDiv({ cls: 'buba-inspector-label', text: row.label })), row.label]);
    cells.push([oneLine(table.createDiv({ cls: 'buba-inspector-value', text: row.value })), row.value]);
  }
  // A cut cell gets the whole text as `aria-label`, which Obsidian shows and hides on hover like the path's;
  // a whole one gets none, a repeated value is noise. Measured again whenever the list changes width.
  const mark = (): void => {
    for (const [cell, text] of cells)
      if (cell.scrollWidth > cell.clientWidth) cell.setAttr('aria-label', text);
      else cell.removeAttribute('aria-label');
  };
  const sizes = new ResizeObserver(mark);
  sizes.observe(table);
  stops.push(() => sizes.disconnect());
  return names;
}

/** An icon button with Obsidian's `.clickable-icon` look: no fill at rest, the hover fill, like the link row. */
function toolButton(parent: HTMLElement, icon: string, label: string, run: () => void): void {
  const button = iconButton(
    parent.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': label } }),
    'medium',
  );
  setIcon(button, icon);
  button.addEventListener('click', run);
}

/** A row cell on one line with "…" (generation.css); on phone and tablet a tap on a cut cell unfolds it, like the path. */
function oneLine(cell: HTMLElement): HTMLElement {
  cell.addClass('buba-gen-cell');
  if (!Platform.isMobile) return cell;
  cell.addEventListener('click', () => {
    if (!cell.hasClass('is-expanded') && cell.scrollWidth <= cell.clientWidth) return;
    cell.toggleClass('is-expanded', !cell.hasClass('is-expanded'));
  });
  return cell;
}
