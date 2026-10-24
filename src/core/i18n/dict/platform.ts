// Labels of the platform, storage and entry point: src/main.ts, src/assets/index.ts,
// src/platform (except canvas-*), src/core/storage. Agent command answers (src/cli,
// src/core/cli) and the log are in English in code, without a dictionary.
import { translator, type Dictionary } from '../index.ts';

const en = {
  commandOpen: 'Open',
  commandAllFiles: 'All files',
  openInBuba: 'Open in Buba',
  importFolder: 'folder: only files can be added',
  importUnnamedNotImage: 'unnamed file — not a PNG, JPEG, WebP or GIF image',
  importNotInVault: "written to disk, but the Obsidian vault doesn't have it",
  importNoFolder: 'folder "{folder}" isn\'t in the vault',
  importNotRead: "couldn't read: {error}",
  importNotWritten: "couldn't write: {error}",
  importPartialRemoved: '{reason}; the partly written file was deleted',
  importPartialKept: '{reason}; the partly written file "{path}" wasn\'t deleted: {error}',
  importPastedImage: 'pasted image',
  fileMissing: 'file not found',
  dataDirRestored:
    "The Buba data folder was deleted — Buba restored this device's records: tags, ratings and comments. " +
    "Other devices restore their own records when they're open.",
  noteName: 'About this folder',
  noteText:
    '# Buba data\n\n' +
    'The Buba plugin keeps tags, ratings, comments, folder colors and icons, file links and generation passports in ' +
    'this folder — one log per device and month. The files themselves stay in their folders; only records about ' +
    'them are here.\n\n' +
    'The inbox folder takes requests from agents: Buba reads each one and removes it; a request it refused goes to ' +
    'inbox/rejected with the reason next to it.\n\n' +
    "Don't delete or rename this folder: without it, tags, ratings and comments are lost. If it's deleted while " +
    'Obsidian is open, Buba brings it back.\n\n' +
    'To remove Buba data for good, turn Buba off first: Settings → Community plugins.\n',
};

export const strings: Dictionary<typeof en> = {
  en,
  ru: {
    commandOpen: 'Открыть Buba',
    commandAllFiles: 'Все файлы',
    openInBuba: 'Открыть в Buba',
    importFolder: 'папка: принимаются только файлы',
    importUnnamedNotImage: 'файл без имени — не картинка PNG, JPEG, WebP или GIF',
    importNotInVault: 'записан на диск, но в хранилище Obsidian его нет',
    importNoFolder: 'папки «{folder}» нет в хранилище',
    importNotRead: 'не прочитан: {error}',
    importNotWritten: 'не записан: {error}',
    importPartialRemoved: '{reason}; недописанный файл удалён',
    importPartialKept: '{reason}; недописанный файл «{path}» не удалён: {error}',
    importPastedImage: 'картинка из буфера',
    fileMissing: 'файла нет',
    dataDirRestored:
      'Папку данных Buba удалили — Buba вернула записи этого устройства: метки, рейтинг и комментарии. ' +
      'Записи других устройств возвращают они сами, когда открыты.',
    noteName: 'Что это за папка',
    noteText:
      '# Данные Buba\n\n' +
      'В этой папке плагин Buba хранит метки, рейтинг, комментарии, цвета и иконки папок, ссылки у файлов и паспорта ' +
      'генераций — по журналу на устройство и месяц. Сами файлы лежат в своих папках, здесь только записи о них.\n\n' +
      'Папка inbox принимает заявки агентов: Buba читает каждую и удаляет; отклонённая заявка уходит в inbox/rejected ' +
      'с причиной рядом.\n\n' +
      'Не удаляйте и не переименовывайте эту папку: без неё метки, рейтинг и комментарии пропадут. Если её удалить, пока ' +
      'Obsidian открыт, Buba вернёт её сама.\n\n' +
      'Чтобы убрать данные Buba насовсем, сначала выключите Buba: Настройки → Сторонние плагины.\n',
  },
};

export const t = translator(strings);
