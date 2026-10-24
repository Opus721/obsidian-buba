// Color window for tag and folder colors: a row of dots, a custom color and a HEX field. Values work like
// colors on Obsidian's canvas: a preset or a custom hex. A click on a color applies it at once (`onPick`) and
// the window stays open; only on close does the chosen custom color go first in "Recent", so the row does not
// reshuffle under the finger. The legacy presets `red…pink` are not offered, but a current one still shows as
// selected. A picker choice reaches `onPick` once per gesture (after `PALETTE_SETTLE_MS`, on close or before
// the next choice): the iPhone system picker sends `change` on every finger move, and every `onPick` is a
// journal line. Recent colors live on the device (src/platform/color/recent.ts), the caller stores pinned
// ones. A color reaches only a dot's `style`, and only after the pattern check (`colorCss`). On a phone the
// window is a full-screen sheet (`mod-lg`).
import { ButtonComponent, ColorComponent, Modal, Notice, TextComponent, setIcon, type App } from 'obsidian';
import { themeHex, type Theme } from '../../core/color/contrast.ts';
import { PINNED_MAX, colorRows, planPin, topRow, type PinnedColors } from '../../core/color/palette.ts';
import {
  colorCss,
  isPresetColor,
  parseHexInput,
  type ColorValue,
  type HexColor,
  type PresetColor,
} from '../../core/color/value.ts';
import { t } from '../../core/i18n/dict/color.ts';
import { recentColors, rememberColor } from '../../platform/color/recent.ts';
import { iconButton } from '../../platform/icon-button.ts';
import { contrastClasses } from './dot.ts';
import './picker.css';

/**
 * Label keys of the legacy presets (src/core/i18n/dict/color.ts): the button name for screen readers and the
 * hover tooltip.
 */
const PRESET_NAMES = {
  red: 'colorRed',
  orange: 'colorOrange',
  yellow: 'colorYellow',
  green: 'colorGreen',
  cyan: 'colorCyan',
  blue: 'colorBlue',
  purple: 'colorPurple',
  pink: 'colorPink',
} as const satisfies Record<PresetColor, Parameters<typeof t>[0]>;
/** HEX sample for the hint and the empty field; substituted so translations cannot change the format. */
const HEX_FORMAT = '#rrggbb';
/**
 * Pause after the last picker `change` before the color is applied. iOS WebKit sets the value with `input`
 * and `change` on every finger move in the system picker (WKFormColorControl.mm ignores `continuously` in
 * `didSelectColor:continuously:`; WebPageIOS.mm uses `DispatchInputAndChangeEvent`), about 60 times a second,
 * and the journal is append-only. Desktop Chromium sends `change` once, when the picker closes.
 */
const PALETTE_SETTLE_MS = 400;

export interface ColorPickerOptions {
  /** Window title, e.g. `Color of tag "reference"`. */
  title: string;
  /** Current color: its dot is selected and its HEX is in the field; `null` for no color. */
  value: ColorValue | null;
  /** Pinned colors, stored by the caller. */
  pinned: PinnedColors;
  /**
   * Called on every click on a color, on "No color" and on Enter with a valid HEX; a picker choice comes once
   * per gesture: after the pause, on close or before the next choice. The window stays open.
   */
  onPick(value: ColorValue | null): void;
  /** The window was closed: Esc, the close button or a click outside. */
  onClose?(): void;
}

/** A dot in the window and its value, used to mark the selected one. */
interface Swatch {
  el: HTMLElement;
  value: ColorValue | null;
}

export class ColorPickerModal extends Modal {
  readonly #options: ColorPickerOptions;
  /** The selected color, the last one applied; the current color on open. */
  #selected: ColorValue | null;
  /** Something was picked, so on close the chosen custom color goes to "Recent". */
  #picked = false;
  #theme: Theme = 'light';
  #top: Swatch[] = [];
  #topEl: HTMLElement | null = null;
  #rows: Swatch[] = [];
  #rowsEl: HTMLElement | null = null;
  #palette: ColorComponent | null = null;
  /** Custom color dot: the picker input lies in it transparent, its color is `--buba-color`. */
  #well: HTMLElement | null = null;
  #hex: TextComponent | null = null;
  #hint: HTMLElement | null = null;
  #copy: ButtonComponent | null = null;
  #pin: ButtonComponent | null = null;
  /**
   * The window is setting the picker value itself: Obsidian's `setValue` calls `onChange`, and that is not a
   * choice.
   */
  #syncing = false;
  /** A picker choice not yet sent to `onPick`, and its pause timer (`PALETTE_SETTLE_MS`). */
  #pending: HexColor | null = null;
  #settle = 0;
  /**
   * A "Pin" or "Unpin" write is in flight, so new presses are ignored: the rows redraw only after the write,
   * and a second tap on the old list would bypass the limit or pin a color twice.
   */
  #busy = false;

  constructor(app: App, options: ColorPickerOptions) {
    super(app);
    this.#options = options;
    this.#selected = options.value;
  }

  override onOpen(): void {
    this.setTitle(this.#options.title);
    this.modalEl.addClass('mod-lg', 'buba-color-modal');
    this.contentEl.addClass('buba-color-content');
    this.#theme = this.modalEl.doc?.body?.hasClass('theme-dark') ? 'dark' : 'light';
    // The top row is the "Palette" group, like "Recent" and "Custom color".
    const palette = this.contentEl.createDiv({ cls: 'buba-color-group mod-palette' });
    palette.createDiv({ cls: 'buba-color-label', text: t('groupPalette') });
    this.#topEl = palette.createDiv({ cls: 'buba-color-row' });
    this.#drawTop();
    this.#rowsEl = this.contentEl.createDiv({ cls: 'buba-color-rows' });
    this.#drawRows();
    this.#drawCustom(this.contentEl);
    this.#showSelected();
  }

  override onClose(): void {
    this.#applyPalette();
    this.contentEl.empty();
    if (this.#picked) rememberColor(this.app, this.#selected);
    this.#options.onClose?.();
  }

  /** A color dot: click, Enter or Space selects it. A value that is not a color by pattern gets no dot. */
  #swatch(parent: HTMLElement, value: ColorValue, list: Swatch[]): void {
    const css = colorCss(value);
    if (css === null) return;
    const el = parent.createDiv({
      cls: ['buba-color-swatch', ...contrastClasses(value)].join(' '),
      attr: {
        role: 'button',
        tabindex: 0,
        'aria-label': isPresetColor(value) ? t(PRESET_NAMES[value]) : value,
      },
    });
    el.setCssProps({ '--buba-color': css });
    list.push({ el, value });
    onActivate(el, () => this.#pick(value));
  }

  /** "No color" clears the color. */
  #none(parent: HTMLElement): void {
    const el = parent.createDiv({
      cls: 'buba-color-swatch mod-none',
      attr: { role: 'button', tabindex: 0, 'aria-label': t('noColor') },
    });
    setIcon(el, 'ban');
    this.#top.push({ el, value: null });
    onActivate(el, () => this.#pick(null));
  }

  /**
   * Top row: the fixed colors, the current legacy theme color if it is not pinned, and "No color". Also
   * redrawn after "Pin / Unpin": a pinned legacy color appears only in "Pinned" (`topRow`).
   */
  #drawTop(): void {
    const el = this.#topEl;
    if (!el) return;
    el.empty();
    this.#top = [];
    for (const value of topRow(this.#options.value, this.#options.pinned.list()))
      this.#swatch(el, value, this.#top);
    this.#none(el);
  }

  /** Pinned, then recent without pinned: plain dots without icons; each group is a label and a row. */
  #drawRows(): void {
    const el = this.#rowsEl;
    if (!el) return;
    el.empty();
    this.#rows = [];
    const { pinned, recent } = colorRows(recentColors(this.app), this.#options.pinned.list());
    const group = (title: string, values: readonly ColorValue[]): void => {
      if (!values.length) return;
      const box = el.createDiv({ cls: 'buba-color-group' });
      box.createDiv({ cls: 'buba-color-label', text: title });
      const row = box.createDiv({ cls: 'buba-color-row' });
      for (const value of values) this.#swatch(row, value, this.#rows);
    };
    group(t('groupPinned'), pinned);
    group(t('groupRecent'), recent);
  }

  /**
   * "Custom color" in one row: the custom color dot, "HEX", the HEX field, round "Copy" and "Pin / Unpin".
   * The dot is our own `label` with the `ColorComponent` input lying in it transparent, as in Obsidian's
   * canvas color menu: pressing the dot opens the system color picker. The round buttons are
   * `ButtonComponent`s with a class (`setClass`), which `ExtraButtonComponent` lacks.
   */
  #drawCustom(parent: HTMLElement): void {
    const box = parent.createDiv({ cls: 'buba-color-group' });
    box.createDiv({ cls: 'buba-color-label', text: t('groupCustom') });
    const row = box.createDiv({ cls: 'buba-color-custom' });
    const well = row.createEl('label', { cls: 'buba-color-well' });
    this.#well = well;
    this.#palette = new ColorComponent(well).onChange((value) => {
      if (!this.#syncing) this.#fromPalette(value);
    });
    well.querySelector('input')?.setAttr('aria-label', t('colorWell'));
    this.#paintWell(this.#palette.getValue());
    row.createSpan({ cls: 'buba-color-hex', text: 'HEX', attr: { 'aria-hidden': 'true' } });
    this.#hex = new TextComponent(row).setPlaceholder(HEX_FORMAT).onChange((text) => this.#typed(text));
    this.#hex.inputEl.setAttr('aria-label', 'HEX');
    this.#hex.inputEl.setAttr('autocapitalize', 'off');
    this.#hex.inputEl.setAttr('spellcheck', 'false');
    this.#hex.inputEl.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || evt.isComposing) return;
      evt.preventDefault();
      const target = this.#target();
      if (target !== null) this.#pick(target);
    });
    this.#copy = new ButtonComponent(row)
      .setClass('buba-color-round')
      .setIcon('copy')
      .setTooltip(t('copyHex'))
      .onClick(() => this.#copyHex());
    this.#pin = new ButtonComponent(row).setClass('buba-color-round').onClick(() => void this.#togglePin());
    iconButton(this.#copy.buttonEl, 'filled');
    iconButton(this.#pin.buttonEl, 'filled');
    this.#hint = box.createDiv({ cls: 'buba-color-hint' });
  }

  /** A choice: the color applies at once, the window stays open, the selection and HEX move to it. */
  #pick(value: ColorValue | null): void {
    this.#applyPalette();
    this.#choose(value);
    this.#options.onPick(value);
  }

  /** Shows the chosen color in the window (selection, HEX field, picker); on close it goes to "Recent". */
  #choose(value: ColorValue | null): void {
    this.#selected = value;
    this.#picked = true;
    this.#showSelected();
  }

  /** The selected color is marked, its HEX in the field and picker; without a color the field is empty. */
  #showSelected(): void {
    this.#mark();
    const hex = themeHex(this.#selected, this.#theme);
    this.#hex?.setValue(hex ?? '');
    if (hex) this.#setPalette(hex);
    this.#hint?.setText('');
    this.#updateButtons();
  }

  #mark(): void {
    for (const { el, value } of [...this.#top, ...this.#rows])
      el.toggleClass('is-active', value === this.#selected);
  }

  #setPalette(hex: string): void {
    this.#syncing = true;
    try {
      this.#palette?.setValue(hex);
    } finally {
      this.#syncing = false;
    }
    this.#paintWell(hex);
  }

  /** Custom color dot gets the picker color; it reaches `style` only after the pattern check. */
  #paintWell(value: string): void {
    const hex = parseHexInput(value);
    if (hex) this.#well?.setCssProps({ '--buba-color': hex });
  }

  /**
   * Typed into the HEX field: a valid color goes into the picker and applies on Enter; the typed text is not
   * rewritten.
   */
  #typed(text: string): void {
    const hex = parseHexInput(text);
    if (hex) this.#setPalette(hex);
    this.#hint?.setText(hex === null && text.trim() !== '' ? t('hexHint', { format: HEX_FORMAT }) : '');
    this.#updateButtons();
  }

  /**
   * Chosen in the picker (`change` event): the window shows the color at once, but `onPick` gets it after a
   * pause, so one finger move in the iPhone system picker is one choice, not one per frame.
   */
  #fromPalette(value: string): void {
    const hex = parseHexInput(value);
    if (!hex) return;
    this.#choose(hex);
    this.#pending = hex;
    const win = this.modalEl.win;
    win.clearTimeout(this.#settle);
    this.#settle = win.setTimeout(() => this.#applyPalette(), PALETTE_SETTLE_MS);
  }

  /** Sends the deferred picker choice to `onPick` now: on the pause, on close and before any next choice. */
  #applyPalette(): void {
    if (this.#settle) this.modalEl.win.clearTimeout(this.#settle);
    this.#settle = 0;
    const hex = this.#pending;
    if (hex === null) return;
    this.#pending = null;
    this.#options.onPick(hex);
  }

  /**
   * The HEX field's color, which Enter, "Copy" and "Pin" act on: if the field holds the selected color's HEX,
   * the selected color (a legacy theme color by name, not hex); another valid HEX, that one; empty or
   * invalid, `null`.
   */
  #target(): ColorValue | null {
    const hex = parseHexInput(this.#hex?.getValue() ?? '');
    if (hex === null) return null;
    return hex === themeHex(this.#selected, this.#theme) ? this.#selected : hex;
  }

  /** Without a valid HEX "Copy" and "Pin" are disabled; a pinned color shows "Unpin". */
  #updateButtons(): void {
    const target = this.#target();
    const pinned = target !== null && this.#options.pinned.list().includes(target);
    this.#copy?.setDisabled(target === null);
    this.#pin
      ?.setIcon(pinned ? 'pin-off' : 'pin')
      .setTooltip(pinned ? t('unpin') : t('pin'))
      .setDisabled(target === null);
  }

  #copyHex(): void {
    const hex = parseHexInput(this.#hex?.getValue() ?? '');
    if (!hex) return;
    navigator.clipboard.writeText(hex).then(
      () => new Notice(t('hexCopied')),
      (error: unknown) => {
        console.error('Buba: HEX not copied', error);
        new Notice(t('hexCopyFailed'));
      },
    );
  }

  async #togglePin(): Promise<void> {
    const target = this.#target();
    if (target === null || this.#busy) return;
    this.#applyPalette();
    if (this.#options.pinned.list().includes(target)) await this.#unpin(target);
    else await this.#doPin(target);
  }

  async #doPin(value: ColorValue): Promise<void> {
    const plan = planPin(this.#options.pinned.list(), value);
    if (plan === 'full') {
      new Notice(t('pinnedFull', { count: PINNED_MAX }));
      return;
    }
    if (plan !== 'pin') return;
    await this.#write(() => this.#options.pinned.pin(value), t('pinFailed'), 'pinned');
  }

  async #unpin(value: ColorValue): Promise<void> {
    await this.#write(() => this.#options.pinned.unpin(value), t('unpinFailed'), 'unpinned');
  }

  /**
   * Writes the pinned list: presses are ignored while it runs, then the rows and button follow the new list.
   * `failed` is the notice text in the Buba language, `action` a word for the error log (English, for
   * developers).
   */
  async #write(run: () => Promise<void>, failed: string, action: 'pinned' | 'unpinned'): Promise<void> {
    this.#busy = true;
    try {
      await run();
    } catch (error) {
      console.error(`Buba: color not ${action}`, error);
      new Notice(failed);
      return;
    } finally {
      this.#busy = false;
    }
    this.#drawTop();
    this.#drawRows();
    this.#mark();
    this.#updateButtons();
  }
}

/** Opens the color window; every choice arrives in `onPick`, closing in `onClose`. */
export function openColorPicker(app: App, options: ColorPickerOptions): ColorPickerModal {
  const modal = new ColorPickerModal(app, options);
  modal.open();
  return modal;
}

/** A dot is a button: click, tap, Enter and Space. */
function onActivate(el: HTMLElement, run: () => void): void {
  el.addEventListener('click', run);
  el.addEventListener('keydown', (evt) => {
    if (evt.key !== 'Enter' && evt.key !== ' ') return;
    evt.preventDefault();
    run();
  });
}
