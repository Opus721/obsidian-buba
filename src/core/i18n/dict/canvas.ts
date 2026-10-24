// Labels of the canvas bridge (src/canvas): tiles dropped onto an Obsidian canvas.
import { translator, type Dictionary } from '../index.ts';

const en = {
  confirmTitle: 'Add to canvas',
  confirmBody: 'Cards: {count}. Add them all to the canvas?',
  confirmButton: 'Add',
  cancel: 'Cancel',
  otherVault: "Tiles from another vault can't be added to this canvas",
  notAdded: "Cards weren't added: {reason}",
  reasonNotJson: "canvas text isn't a JSON Canvas object",
  reasonNodes: "canvas nodes isn't a list",
  reasonNoId: "couldn't pick a card id: 100 collisions in a row with existing ones",
  reasonNotFound: 'canvas is not in the vault: {path}',
};

export const strings: Dictionary<typeof en> = {
  en,
  ru: {
    confirmTitle: 'Положить на холст',
    confirmBody: 'Карточек: {count}. Положить все на холст?',
    confirmButton: 'Положить',
    cancel: 'Отмена',
    otherVault: 'Плитки из другого хранилища на этот холст не кладутся',
    notAdded: 'Карточки не положены: {reason}',
    reasonNotJson: 'Текст холста — не объект JSON Canvas',
    reasonNodes: 'В холсте nodes — не массив',
    reasonNoId: 'Не подобрать id карточки: 100 совпадений с лежащими подряд',
    reasonNotFound: 'Холста нет в хранилище: {path}',
  },
};

export const t = translator(strings);
