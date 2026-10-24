// Labels of the color window (src/assets/color).
import { translator, type Dictionary } from '../index.ts';

const en = {
  colorRed: 'Red',
  colorOrange: 'Orange',
  colorYellow: 'Yellow',
  colorGreen: 'Green',
  colorCyan: 'Cyan',
  colorBlue: 'Blue',
  colorPurple: 'Purple',
  colorPink: 'Pink',
  noColor: 'No color',
  groupPalette: 'Palette',
  groupPinned: 'Pinned',
  groupRecent: 'Recent',
  groupCustom: 'Custom color',
  colorWell: 'Color picker',
  hexHint: 'Use {format}: six characters 0–9 and a–f',
  copyHex: 'Copy HEX',
  pin: 'Pin',
  unpin: 'Unpin',
  hexCopied: 'HEX copied',
  hexCopyFailed: "Couldn't copy HEX",
  pinnedFull: {
    one: '{count} color pinned — unpin one first',
    other: '{count} colors pinned — unpin one first',
  },
  pinFailed: "Couldn't pin the color",
  unpinFailed: "Couldn't unpin the color",
};

export const strings: Dictionary<typeof en> = {
  en,
  ru: {
    colorRed: 'Красный',
    colorOrange: 'Оранжевый',
    colorYellow: 'Жёлтый',
    colorGreen: 'Зелёный',
    colorCyan: 'Голубой',
    colorBlue: 'Синий',
    colorPurple: 'Фиолетовый',
    colorPink: 'Розовый',
    noColor: 'Без цвета',
    groupPalette: 'Палитра',
    groupPinned: 'Закреплённые',
    groupRecent: 'Последние',
    groupCustom: 'Свой цвет',
    colorWell: 'Палитра',
    hexHint: 'Нужно {format}: шесть знаков 0–9 и a–f',
    copyHex: 'Копировать HEX',
    pin: 'Закрепить',
    unpin: 'Открепить',
    hexCopied: 'HEX скопирован',
    hexCopyFailed: 'HEX скопировать не удалось',
    pinnedFull: {
      one: 'Закреплён {count} цвет — сначала открепите один',
      few: 'Закреплено {count} цвета — сначала открепите один',
      many: 'Закреплено {count} цветов — сначала открепите один',
      other: 'Закреплено {count} цвета — сначала открепите один',
    },
    pinFailed: 'Цвет закрепить не удалось',
    unpinFailed: 'Цвет открепить не удалось',
  },
};

export const t = translator(strings);
