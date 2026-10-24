// Square file thumbnails of the generation sections — references of a generation, generations that use a
// file — and the tags inside a prompt. A thumbnail is the device preview (as a grid tile), a format icon, or
// a music note for sound; video gets its duration. Clicks act like a grid tile: open (the Buba viewer pages
// through the listed files), Ctrl/Cmd or the middle button for a new tab, Alt to show the file in its folder;
// the right button or a long press opens the file menu with Obsidian's and plugins' items. A reference that
// is not in the vault is a grey square with a question mark: no click, a menu to copy its name and path.
// Other modules are reached by workspace events (src/core/inspector/events.ts), never imported.
import { Keymap, Menu, Notice, setIcon, type Plugin, type TFile } from 'obsidian';
import { formatFamily } from '../core/format/family.ts';
import type { RefMedia } from '../core/generation/refs.ts';
import { t } from '../core/i18n/dict/generation.ts';
import { REVEAL_IN_TREE, SHOW_IN_FOLDER, VIEW_FILES } from '../core/inspector/events.ts';
import { mediaDuration } from '../platform/media/duration.ts';
import { previewKind } from '../platform/previews/plan.ts';
import { previewStore } from '../platform/previews/store.ts';
import { RowMenus, showRowMenu } from '../platform/row-menus.ts';

/** `file-menu` source of the generation sections. */
export const MENU_SOURCE = 'buba-generation';

/** A file to draw: where it is now (`null` if not found), and what was recorded. */
export interface ThumbFile {
  file: TFile | null;
  /** Recorded path: the old path of a missing reference. */
  path: string;
  /** File name to show when the file is missing. */
  name: string;
  media: RefMedia;
}

/** The thumbnails drawn in one section draw, with the list the viewer pages through. */
export class ThumbSet {
  readonly #plugin: Plugin;
  readonly #files: ThumbFile[] = [];
  readonly #cleanups: (() => void)[] = [];
  /**
   * Menus by right click or, on a phone, long press: iOS sends no `contextmenu` on a hold, and Obsidian
   * synthesizes one only for draggable elements. One finger, so one touch state for the set.
   */
  readonly #menus = new RowMenus();
  /**
   * Paths whose previews this set wants. The store keeps one request per consumer and a new one replaces the
   * old, so every picture asks again with the whole set.
   */
  readonly #wanted = new Set<string>();

  constructor(plugin: Plugin) {
    this.#plugin = plugin;
  }

  /** Paths the viewer pages through: files that exist, in drawing order, each once. */
  #paths(): string[] {
    return [...new Set(this.#files.flatMap((item) => (item.file ? [item.file.path] : [])))];
  }

  /** Adds a file to the list; returns its open and menu handlers for `bind`. */
  add(item: ThumbFile): ThumbFile {
    this.#files.push(item);
    return item;
  }

  /**
   * A square thumbnail button: preview or icon, the role badge top left, the duration bottom left; `tip` is
   * the hover text. A known role is an icon, its label is in `tip`; an unknown one is text, cut to the tile.
   */
  thumb(
    parent: HTMLElement,
    item: ThumbFile,
    tip: string,
    role: { label: string; icon: string | null } | null,
  ): HTMLElement {
    const button = parent.createEl('button', {
      cls: `buba-gen-thumb mod-${item.media}`,
      attr: { 'aria-label': tip, type: 'button' },
    });
    if (!item.file) {
      button.addClass('is-missing');
      setIcon(button.createSpan({ cls: 'buba-gen-thumb-icon' }), 'file-question');
    } else {
      this.#picture(button, item.file, item.media, 'buba-gen-thumb-icon');
      if (item.media === 'video' || item.media === 'audio') this.#duration(button, item.file);
    }
    if (role?.icon) setIcon(button.createSpan({ cls: 'buba-gen-thumb-role mod-icon' }), role.icon);
    else if (role) button.createSpan({ cls: 'buba-gen-thumb-role' }).createSpan({ text: role.label });
    this.bind(button, item);
    return button;
  }

  /** A tag inside a prompt: a small thumbnail and the tag text, colored by media type. */
  mention(parent: HTMLElement, item: ThumbFile, text: string, tip: string): HTMLElement {
    const button = parent.createEl('button', {
      cls: `buba-gen-mention mod-${item.media}`,
      attr: { 'aria-label': tip, type: 'button' },
    });
    const mini = button.createSpan({ cls: 'buba-gen-mention-mini' });
    if (item.file) this.#picture(mini, item.file, item.media, 'buba-gen-mention-icon');
    else {
      button.addClass('is-missing');
      setIcon(mini, 'file-question');
    }
    button.createSpan({ text });
    this.bind(button, item);
    return button;
  }

  /** Releases preview and duration subscriptions; the section cleanup. */
  clear(): void {
    for (const cleanup of this.#cleanups.splice(0)) cleanup();
    this.#files.length = 0;
    this.#menus.stop();
    if (!this.#wanted.size) return;
    this.#wanted.clear();
    previewStore(this.#plugin).want([], this);
  }

  /** Preview image when the device has one; otherwise the format icon, a music note for sound. */
  #picture(el: HTMLElement, file: TFile, media: RefMedia, iconCls: string): void {
    const store = previewStore(this.#plugin);
    const draw = (): void => {
      el.querySelector(':scope > .buba-gen-picture')?.remove();
      const preview = store.get(file.path);
      const holder = el.createSpan({ cls: 'buba-gen-picture' });
      el.prepend(holder);
      if (preview && media !== 'audio') holder.createEl('img', { attr: { src: preview.url, alt: '' } });
      else
        setIcon(
          holder.createSpan({ cls: iconCls }),
          media === 'audio' ? 'music' : formatFamily(file.extension).icon,
        );
    };
    draw();
    if (media === 'audio' || !previewKind(file.extension)) return;
    // A ready preview is wanted too: the store keeps wanted previews when it trims its memory.
    this.#wanted.add(file.path);
    store.want([...this.#wanted], this);
    const offReady = store.onReady((path) => {
      if (path === file.path) draw();
    });
    const offRemoved = store.onRemoved((path) => {
      if (path === file.path) draw();
    });
    this.#cleanups.push(offReady, offRemoved);
  }

  /** Duration badge of video and sound, read from the file's metadata; nothing while unknown. */
  #duration(button: HTMLElement, file: TFile): void {
    const reading = new AbortController();
    this.#cleanups.push(() => reading.abort());
    void mediaDuration(this.#plugin.app.vault.getResourcePath(file), reading.signal).then((seconds) => {
      if (reading.signal.aborted || seconds === null) return;
      const badge = button.createSpan({ cls: 'buba-gen-thumb-badge' });
      if (button.hasClass('mod-video')) setIcon(badge.createSpan({ cls: 'buba-gen-thumb-play' }), 'play');
      badge.createSpan({ text: clock(seconds) });
    });
  }

  /** Clicks and the menu of a thumbnail or tag. */
  bind(el: HTMLElement, item: ThumbFile): void {
    const { workspace } = this.#plugin.app;
    // The middle button press is cancelled, as on Obsidian's search rows: otherwise Windows starts
    // middle-button autoscroll and no `auxclick` follows.
    el.addEventListener('mousedown', (evt) => {
      if (evt.button === 1) evt.preventDefault();
    });
    const open = (evt: MouseEvent): void => {
      const { file } = item;
      if (!file) return;
      evt.preventDefault();
      const paths = this.#paths();
      const index = paths.indexOf(file.path);
      // Ctrl+Alt splits and Ctrl+Alt+Shift opens a window in Obsidian: a mod click is checked first.
      if (Keymap.isModEvent(evt) || evt.button === 1) workspace.trigger(VIEW_FILES, paths, index, true);
      else if (evt.altKey) workspace.trigger(SHOW_IN_FOLDER, file.path);
      else workspace.trigger(VIEW_FILES, paths, index, false);
    };
    el.addEventListener('click', (evt) => {
      // The click a phone sends after a long press or a finger move is not a tap.
      if (evt.button === 0 && this.#menus.click()) open(evt);
    });
    el.addEventListener('auxclick', (evt) => {
      if (evt.button === 1) open(evt);
    });
    // The panel's own menu would follow by bubbling.
    el.addEventListener('contextmenu', (evt) => evt.stopPropagation());
    this.#menus.attach(el, (at) => void showRowMenu(this.#menu(item), at));
  }

  #menu(item: ThumbFile): Menu {
    const { workspace } = this.#plugin.app;
    const menu = new Menu();
    const { file } = item;
    if (!file) {
      menu.addItem((each) =>
        each
          .setTitle(t('copyName'))
          .setIcon('copy')
          .onClick(() => void copy(item.name, t('nameCopied'))),
      );
      menu.addItem((each) =>
        each
          .setTitle(t('copyOldPath'))
          .setIcon('copy')
          .onClick(() => void copy(item.path, t('pathCopied'))),
      );
      return menu;
    }
    menu.addItem((each) =>
      each
        .setTitle(t('showInFolder'))
        .setIcon('folder-open')
        .setSection('open')
        .onClick(() => workspace.trigger(SHOW_IN_FOLDER, file.path)),
    );
    menu.addItem((each) =>
      each
        .setTitle(t('revealInTree'))
        .setIcon('folder-tree')
        .setSection('open')
        .onClick(() => workspace.trigger(REVEAL_IN_TREE, file.path)),
    );
    // Obsidian and plugins add their items, the file panel its "File panel".
    workspace.trigger('file-menu', menu, file, MENU_SOURCE);
    return menu;
  }
}

/** Duration as on a grid tile: m:ss, h:mm:ss from an hour. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Copies text with a notice; a refused clipboard says so. */
export async function copy(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    new Notice(done);
  } catch {
    new Notice(t('copyFailed'));
  }
}
