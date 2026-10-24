// Labels of the folder tree (src/assets/tree, src/core/icon).
import { translator, type Dictionary } from '../index.ts';

const en = {
  allFiles: 'All files',

  commandNewFolder: 'Create new folder…',
  commandNewSubfolder: 'Create subfolder in open folder…',
  commandNewFolderBeside: 'Create folder next to open folder…',
  commandFolderColor: 'Change color of open folder…',
  commandFolderIcon: 'Change icon of open folder…',
  commandRevealFolder: 'Reveal open folder in tree',
  commandCollapseAll: 'Collapse all folders',
  commandExpandAll: 'Expand all folders',
  commandOrderAlphabetical: 'Sort folders by name (A to Z)',
  commandOrderAlphabeticalReverse: 'Sort folders by name (Z to A)',

  sortOrder: 'Change sort order',
  orderAlphabetical: 'Name (A to Z)',
  orderAlphabeticalReverse: 'Name (Z to A)',
  collapseAll: 'Collapse all',
  expandAll: 'Expand all',

  newFolder: 'New folder',
  newFolderIn: 'New folder in “{name}”',
  newFolderItem: 'New folder…',
  newSubfolderItem: 'New subfolder…',
  newFolderBesideItem: 'New folder alongside…',
  create: 'Create',
  name: 'Name',
  folderNameTaken: "Couldn't create folder “{name}”: this name is already taken here",
  folderCreateFailed: "Couldn't create folder “{name}”",

  folderColorItem: 'Folder color…',
  folderIconItem: 'Folder icon…',
  folderColorTitle: 'Color of folder “{name}”',
  folderColorFailed: "Couldn't set the folder color",
  folderIconFailed: "Couldn't set the folder icon",

  iconSearch: 'Icon name: {examples}',
  iconsShown: {
    one: 'Showing up to {limit} of {count} icon. Search to find the rest.',
    other: 'Showing up to {limit} of {count} icons. Search to find the rest.',
  },
  iconCurrent: 'Current',
  iconDefault: 'Folder (default)',
};

export const strings: Dictionary<typeof en> = {
  en,
  ru: {
    allFiles: 'Все файлы',

    commandNewFolder: 'Создать папку…',
    commandNewSubfolder: 'Создать подпапку в открытой папке…',
    commandNewFolderBeside: 'Создать папку рядом с открытой…',
    commandFolderColor: 'Изменить цвет открытой папки…',
    commandFolderIcon: 'Изменить иконку открытой папки…',
    commandRevealFolder: 'Показать открытую папку в дереве',
    commandCollapseAll: 'Свернуть все папки',
    commandExpandAll: 'Развернуть все папки',
    commandOrderAlphabetical: 'Упорядочить папки по имени (от А до Я)',
    commandOrderAlphabeticalReverse: 'Упорядочить папки по имени (от Я до А)',

    sortOrder: 'Порядок сортировки',
    orderAlphabetical: 'По имени (от А до Я)',
    orderAlphabeticalReverse: 'По имени (от Я до А)',
    collapseAll: 'Свернуть все',
    expandAll: 'Развернуть все',

    newFolder: 'Новая папка',
    newFolderIn: 'Новая папка в «{name}»',
    newFolderItem: 'Новая папка…',
    newSubfolderItem: 'Новая подпапка…',
    newFolderBesideItem: 'Новая папка рядом…',
    create: 'Создать',
    name: 'Имя',
    folderNameTaken: 'Папка «{name}» не создана: такое имя здесь уже занято',
    folderCreateFailed: 'Папку «{name}» создать не удалось',

    folderColorItem: 'Цвет папки…',
    folderIconItem: 'Иконка папки…',
    folderColorTitle: 'Цвет папки «{name}»',
    folderColorFailed: 'Цвет папки задать не удалось',
    folderIconFailed: 'Иконку папки задать не удалось',

    iconSearch: 'Название по-английски: {examples}',
    iconsShown: {
      one: 'Показано до {limit} из {count} варианта. Остальные доступны через поиск по всему набору.',
      few: 'Показано до {limit} из {count} вариантов. Остальные доступны через поиск по всему набору.',
      many: 'Показано до {limit} из {count} вариантов. Остальные доступны через поиск по всему набору.',
      other: 'Показано до {limit} из {count} варианта. Остальные доступны через поиск по всему набору.',
    },
    iconCurrent: 'текущая',
    iconDefault: 'Папка (по умолчанию)',
  },
};

export const t = translator(strings);
