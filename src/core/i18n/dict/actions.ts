// Labels of file actions (src/assets/actions, src/core/actions): tile commands and menu, rename, delete, move
// and links dialogs, undo and redo, adding files.
import { translator, type Dictionary } from '../index.ts';

const en = {
  // Commands on the grid selection.
  commandRenameFile: 'Rename selected file…',
  commandRenameWithExtension: 'Rename selected file with extension…',
  commandDuplicateFile: 'Make a copy of selected file',
  commandDeleteFiles: 'Delete selected files',
  commandUndo: 'Undo',
  commandRedo: 'Redo',
  commandAddFiles: 'Add files to open folder',
  commandAddPhotos: 'Add photos and videos to open folder',

  // Tile menu and rename dialog.
  rename: 'Rename',
  renameWithExtension: 'Rename with extension…',
  makeCopy: 'Make a copy',
  delete: 'Delete',
  deleteCount: { one: 'Delete {count} file', other: 'Delete {count} files' },
  copyFailed: 'Couldn\'t make a copy of "{name}"',
  renameTitle: 'Rename file',
  renameTitleWithExtension: 'Rename with extension',
  newName: 'New name',
  renameButton: 'Rename',
  renameFailed: 'Couldn\'t rename "{name}"',

  // Delete.
  deleteFailed: 'Couldn\'t delete "{name}" — see the console for details',
  deleteFilesTitle: 'Delete files',
  deleteFilesConfirm: {
    one: 'Are you sure you want to delete {count} file?',
    other: 'Are you sure you want to delete {count} files?',
  },
  cancel: 'Cancel',
  deleteButton: 'Delete',
  deleteFilesFailed: "Couldn't delete the files — see the console for details",
  deletedSome: {
    one: 'Deleted {done} of {count} file; {failed} failed — see the console for details',
    other: 'Deleted {done} of {count} files; {failed} failed — see the console for details',
  },
  deletedAll: { one: 'Deleted {count} file', other: 'Deleted {count} files' },
  trashUnknown:
    'Where they go — system trash, Obsidian trash or permanently — is set in Obsidian: Settings → Files and links.',
  trashSystem: 'They will be moved to your system trash.',
  trashLocal:
    'They will be moved to your Obsidian trash, which is located in the "{folder}" hidden folder in your vault.',
  trashNone: 'The files will be deleted permanently.',
  trashUnknownOne:
    'Where it goes — system trash, Obsidian trash or permanently — is set in Obsidian: Settings → Files and links.',
  trashSystemOne: 'It will be moved to your system trash.',
  trashLocalOne:
    'It will be moved to your Obsidian trash, which is located in the "{folder}" hidden folder in your vault.',
  trashNoneOne: 'The file will be deleted permanently.',

  // Deleting references of generations: the file stays named in their passports.
  deleteRefTitle: 'Delete "{name}"?',
  refOfGenerations: {
    one: 'This file is a reference in {count} generation.',
    other: 'This file is a reference in {count} generations.',
  },
  refsInBatch: { one: '{count} of them is a reference', other: '{count} of them are references' },
  inGenerations: { one: 'in {count} generation.', other: 'in {count} generations.' },
  refsAfterDelete: {
    one: 'After deletion it will show a grey square with the file name instead of a thumbnail.',
    other: 'After deletion they will show a grey square with the file name instead of a thumbnail.',
  },
  showGenerations: 'Show generations',

  // Names of new files and folders, name checks.
  untitled: 'Untitled',
  emptyName: 'Name is empty',
  badFileName:
    "Can't name a file like this: a name can't contain {chars}, start with a dot, end with a dot or a space, be a device name like {device} or be longer than {max} characters",
  badFolderName:
    "Can't name a folder like this: a name can't contain {chars}, start with a dot, end with a dot or a space, be a device name like {device} or be longer than {max} characters",
  nameUnchanged: "Name hasn't changed",
  fileExists: 'This folder already has "{name}"',
  folderExistsRoot: 'The vault root already has "{name}"',
  folderExistsRootCase: 'The vault root already has "{name}" — for the disk it\'s the same name',
  folderExistsIn: 'Folder "{folder}" already has "{name}"',
  folderExistsInCase: 'Folder "{folder}" already has "{name}" — for the disk it\'s the same name',

  // Batch move and interrupted move.
  otherVaultTiles: "Tiles from another Obsidian vault can't be moved here",
  movedInto: { one: 'Moved to "{folder}": {count} file', other: 'Moved to "{folder}": {count} files' },
  nothingMovedInto: 'Nothing moved to "{folder}"',
  moveFailedJournal:
    "Move failed: the Buba action log wasn't written — see the developer console for details",
  moveFinished: { one: 'Move finished: {count} file', other: 'Move finished: {count} files' },
  moveNotFinished: 'Move not finished',
  resumeFailed: "Couldn't sort out the unfinished Buba move — see the developer console for details",
  notMoved: { one: 'Not moved: {count} file', other: 'Not moved: {count} files' },
  andMore: 'and {count} more',
  resumeTitle: { one: 'Move not finished: {count} file', other: 'Move not finished: {count} files' },
  resumeInterrupted:
    'The Buba move was interrupted: Obsidian closed before all files reached the new folder.',
  resumeHint:
    'Finish — move the remaining files with their links. Leave — the files stay where they are now.',
  finish: 'Finish',
  leave: 'Leave',
  skipMissing: 'file is missing',
  skipSameFolder: 'already in this folder',
  skipIntoItself: 'into itself or its subfolder',
  skipTaken: 'name is taken',
  nameReason: '{name} — {reason}',

  // Links dialog before a move.
  linksEnabled: 'Obsidian setting "Automatically update internal links" is on',
  linksEnableFailed:
    'Couldn\'t turn on the Obsidian setting — Settings → Files and links → "Automatically update internal links"',
  linksTitle: 'Links when moving',
  linksBody:
    'Files linked from notes or canvases in this move: {count}. While the Obsidian setting "Automatically update internal links" is off, Obsidian asks about each such file separately, and closing that dialog leaves the link broken.',
  linksQuestion: 'Turn it on? You can turn it off in Settings → Files and links.',
  turnOn: 'Turn on',
  dontTurnOn: "Don't turn on",

  // Undo and redo.
  undoItem: 'Undo: {step}',
  redoItem: 'Redo: {step}',
  undoFailed: 'Undo failed — see the developer console for details',
  redoFailed: 'Redo failed — see the developer console for details',
  undoFailedJournal:
    "Undo failed: the Buba action log wasn't written — see the developer console for details",
  redoFailedJournal:
    "Redo failed: the Buba action log wasn't written — see the developer console for details",
  nothingToUndo: 'Nothing to undo: Buba undoes moves, renames and deletions made in Buba',
  nothingToRedo: 'Nothing to redo',
  stepTrashOne: 'deleting "{name}"',
  stepTrashMany: { one: 'deleting {count} file', other: 'deleting {count} files' },
  stepRenameOne: 'renaming "{from}" → "{to}"',
  stepRename: 'renaming',
  stepMoveTo: { one: 'moving {count} file to "{folder}"', other: 'moving {count} files to "{folder}"' },
  stepMoveRoot: {
    one: 'moving {count} file to the vault root',
    other: 'moving {count} files to the vault root',
  },
  undone: 'Undone: {step}',
  notUndone: 'Not undone: {step}',
  redone: 'Redone: {step}',
  notRedone: 'Not redone: {step}',
  missedUndo: { one: 'Not restored: {count} file', other: 'Not restored: {count} files' },
  missedRedo: { one: 'Not redone: {count} file', other: 'Not redone: {count} files' },
  quotedPath: '"{path}"',
  pathReason: '"{path}" — {reason}',
  pathTaken: '"{from}" → "{to}" — the name is already taken',
  goneMissing: 'the file is no longer there',
  goneChanged: 'there is a different file there now',
  goneTaken: 'the name is already taken',
  restoreMissing: 'it is no longer in the Obsidian trash',
  restoreChanged: 'a different file is in its place in the Obsidian trash',
  restoreTaken: 'a file with this name already exists in its original location',
  placeWindows: 'from the Windows Recycle Bin',
  placeMac: 'from the Trash',
  placeIos: 'in the Files app → Recently Deleted',
  placeOther: 'from the system trash',
  deletedFilesSetting: 'Settings → Files and links → "Deleted files"',
  systemOne:
    '"{name}" is in the system trash: Buba can\'t take files from there. Restore it {place} — it will return to "{folder}", with its Buba tags',
  systemOneRoot:
    '"{name}" is in the system trash: Buba can\'t take files from there. Restore it {place} — it will return to the vault root, with its Buba tags',
  systemMany: {
    one: "In the system trash: {count} file — Buba can't take files from there. Restore them {place} — they will return to their original locations, with their Buba tags",
    other:
      "In the system trash: {count} files — Buba can't take files from there. Restore them {place} — they will return to their original locations, with their Buba tags",
  },
  foreverOne:
    '"{name}" was deleted permanently — Obsidian is set up this way ({setting}), it can\'t be restored',
  foreverMany: {
    one: "Deleted permanently: {count} file — Obsidian is set up this way ({setting}), they can't be restored",
    other:
      "Deleted permanently: {count} files — Obsidian is set up this way ({setting}), they can't be restored",
  },
  missingOne: '"{name}" wasn\'t found in the Obsidian trash ({folder} folder)',
  missingMany: {
    one: 'Not found in the Obsidian trash ({folder} folder): {count} file',
    other: 'Not found in the Obsidian trash ({folder} folder): {count} files',
  },
  unknownOne:
    '"{name}" isn\'t in the Obsidian trash: it\'s in the system trash or deleted permanently, as set in Obsidian ({setting})',
  unknownMany: {
    one: "Not in the Obsidian trash: {count} file — it's in the system trash or deleted permanently, as set in Obsidian ({setting})",
    other:
      "Not in the Obsidian trash: {count} files — they're in the system trash or deleted permanently, as set in Obsidian ({setting})",
  },
  unseen: {
    one: "Not visible in Obsidian: {count} file — it's on the disk; restart Obsidian so it sees it",
    other: "Not visible in Obsidian: {count} files — they're on the disk; restart Obsidian so it sees them",
  },

  // Adding files.
  adding: 'Adding {index} of {total}…',
  nothingAdded: 'Nothing added',
  added: 'Files added: {count} — to "{folder}"',
  addedTagged: 'Files added: {count} — to "{folder}", tag "{tag}"',
  addedNotTagged: 'Files added: {count} — to "{folder}", tag "{tag}" not added — {reason}',
  addedSourceRefused: 'Files added: {count} — to "{folder}", the source didn\'t accept the files: {error}',
  namedReason: '"{name}" — {reason}',
  notAdded: 'Files not added: {error}',
  addFiles: 'Add files',
  addFilesHere: 'Add files here…',
  addPhotos: 'Add photos and videos',
  photosHere: 'Here: photos and videos…',
  filesHere: 'Here: files…',
  pickNotOpened:
    'The file picker opens only on a click or tap: open a folder in Buba and click the "{action}" icon in the grid header.',
};

export type ActionsSource = typeof en;

export const strings: Dictionary<ActionsSource> = {
  en,
  ru: {
    commandRenameFile: 'Переименовать выделенный файл…',
    commandRenameWithExtension: 'Переименовать выделенный файл вместе с расширением…',
    commandDuplicateFile: 'Создать копию выделенного файла',
    commandDeleteFiles: 'Удалить выделенные файлы',
    commandUndo: 'Отменить',
    commandRedo: 'Повторить',
    commandAddFiles: 'Добавить файлы в открытую папку',
    commandAddPhotos: 'Добавить фото и видео в открытую папку',

    rename: 'Переименовать',
    renameWithExtension: 'Переименовать с расширением…',
    makeCopy: 'Создать копию',
    delete: 'Удалить',
    deleteCount: {
      one: 'Удалить {count} файл',
      few: 'Удалить {count} файла',
      many: 'Удалить {count} файлов',
      other: 'Удалить {count} файла',
    },
    copyFailed: 'Копию «{name}» создать не удалось',
    renameTitle: 'Переименовать файл',
    renameTitleWithExtension: 'Переименовать с расширением',
    newName: 'Новое имя',
    renameButton: 'Переименовать',
    renameFailed: 'Файл «{name}» переименовать не удалось',

    deleteFailed: 'Файл «{name}» удалить не удалось — подробности в консоли',
    deleteFilesTitle: 'Удалить файлы',
    deleteFilesConfirm: {
      one: 'Вы уверены, что хотите удалить {count} файл?',
      few: 'Вы уверены, что хотите удалить {count} файла?',
      many: 'Вы уверены, что хотите удалить {count} файлов?',
      other: 'Вы уверены, что хотите удалить {count} файла?',
    },
    cancel: 'Отмена',
    deleteButton: 'Удалить',
    deleteFilesFailed: 'Удалить файлы не удалось — подробности в консоли',
    deletedSome: {
      one: 'Удалено: {done} из {count} файл; не удалось — {failed}, подробности в консоли',
      few: 'Удалено: {done} из {count} файла; не удалось — {failed}, подробности в консоли',
      many: 'Удалено: {done} из {count} файлов; не удалось — {failed}, подробности в консоли',
      other: 'Удалено: {done} из {count} файла; не удалось — {failed}, подробности в консоли',
    },
    deletedAll: {
      one: 'Удалено: {count} файл',
      few: 'Удалено: {count} файла',
      many: 'Удалено: {count} файлов',
      other: 'Удалено: {count} файла',
    },
    trashUnknown:
      'Куда они уйдут — в корзину системы, в корзину Obsidian или навсегда, — задаёт Obsidian: Настройки → Файлы и ссылки.',
    trashSystem: 'Будут перемещены в системную Корзину.',
    trashLocal:
      'Будут перемещены в корзину Obsidian, которая находится в скрытой папке "{folder}" вашего хранилища.',
    trashNone: 'Файлы будут удалены безвозвратно.',
    trashUnknownOne:
      'Куда он уйдёт — в корзину системы, в корзину Obsidian или навсегда, — задаёт Obsidian: Настройки → Файлы и ссылки.',
    trashSystemOne: 'Будет перемещён в системную Корзину.',
    trashLocalOne:
      'Будет перемещён в корзину Obsidian, которая находится в скрытой папке "{folder}" вашего хранилища.',
    trashNoneOne: 'Файл будет удалён безвозвратно.',

    deleteRefTitle: 'Удалить «{name}»?',
    refOfGenerations: {
      one: 'Этот файл — референс в {count} генерации.',
      few: 'Этот файл — референс в {count} генерациях.',
      many: 'Этот файл — референс в {count} генерациях.',
      other: 'Этот файл — референс в {count} генерации.',
    },
    refsInBatch: {
      one: 'Из них {count} — референс',
      few: 'Из них {count} — референсы',
      many: 'Из них {count} — референсы',
      other: 'Из них {count} — референсы',
    },
    inGenerations: {
      one: 'в {count} генерации.',
      few: 'в {count} генерациях.',
      many: 'в {count} генерациях.',
      other: 'в {count} генерации.',
    },
    refsAfterDelete: {
      one: 'После удаления у неё вместо миниатюры будет серый квадрат с именем файла.',
      few: 'После удаления у них вместо миниатюры будет серый квадрат с именем файла.',
      many: 'После удаления у них вместо миниатюры будет серый квадрат с именем файла.',
      other: 'После удаления у них вместо миниатюры будет серый квадрат с именем файла.',
    },
    showGenerations: 'Показать генерации',

    untitled: 'Без названия',
    emptyName: 'Пустое имя',
    badFileName:
      'Так файл назвать нельзя: в имени не бывает знаков {chars}, точки в начале, точки или пробела в конце, имён устройств вроде {device} и больше {max} знаков',
    badFolderName:
      'Так папку назвать нельзя: в имени не бывает знаков {chars}, точки в начале, точки или пробела в конце, имён устройств вроде {device} и больше {max} знаков',
    nameUnchanged: 'Имя не изменилось',
    fileExists: 'В этой папке уже есть «{name}»',
    folderExistsRoot: 'В корне хранилища уже есть «{name}»',
    folderExistsRootCase: 'В корне хранилища уже есть «{name}» — для диска это одно имя',
    folderExistsIn: 'В папке «{folder}» уже есть «{name}»',
    folderExistsInCase: 'В папке «{folder}» уже есть «{name}» — для диска это одно имя',

    otherVaultTiles: 'Плитки из другого хранилища Obsidian сюда не переносятся',
    movedInto: {
      one: 'Перенесено в «{folder}»: {count} файл',
      few: 'Перенесено в «{folder}»: {count} файла',
      many: 'Перенесено в «{folder}»: {count} файлов',
      other: 'Перенесено в «{folder}»: {count} файла',
    },
    nothingMovedInto: 'В «{folder}» ничего не перенесено',
    moveFailedJournal:
      'Перенос не удался: журнал действий Buba не записался — подробности в консоли разработчика',
    moveFinished: {
      one: 'Перенос докончен: {count} файл',
      few: 'Перенос докончен: {count} файла',
      many: 'Перенос докончен: {count} файлов',
      other: 'Перенос докончен: {count} файла',
    },
    moveNotFinished: 'Перенос не докончен',
    resumeFailed: 'Недоделанный перенос Buba разобрать не удалось — подробности в консоли разработчика',
    notMoved: {
      one: 'Не перенесено: {count} файл',
      few: 'Не перенесено: {count} файла',
      many: 'Не перенесено: {count} файлов',
      other: 'Не перенесено: {count} файла',
    },
    andMore: 'и ещё {count}',
    resumeTitle: {
      one: 'Перенос не закончен: {count} файл',
      few: 'Перенос не закончен: {count} файла',
      many: 'Перенос не закончен: {count} файлов',
      other: 'Перенос не закончен: {count} файла',
    },
    resumeInterrupted: 'Перенос Buba прервался: Obsidian закрылся раньше, чем все файлы легли в новую папку.',
    resumeHint:
      'Докончить — перенести оставшиеся файлы со ссылками. Оставить — файлы остаются там, где лежат сейчас.',
    finish: 'Докончить',
    leave: 'Оставить',
    skipMissing: 'файла нет',
    skipSameFolder: 'уже в этой папке',
    skipIntoItself: 'в саму себя или во вложенную',
    skipTaken: 'имя занято',
    nameReason: '{name} — {reason}',

    linksEnabled: 'Настройка Obsidian «Всегда обновлять внутренние ссылки» включена',
    linksEnableFailed:
      'Настройку Obsidian включить не удалось — Настройки → Файлы и ссылки → «Всегда обновлять внутренние ссылки»',
    linksTitle: 'Ссылки при переносе',
    linksBody:
      'Файлов со ссылками из заметок или досок в этом переносе: {count}. Пока в Obsidian выключена настройка «Всегда обновлять внутренние ссылки», он спрашивает про каждый такой файл отдельно, а закрытое окно оставляет ссылку битой.',
    linksQuestion: 'Включить её? Выключить можно в Настройки → Файлы и ссылки.',
    turnOn: 'Включить',
    dontTurnOn: 'Не включать',

    undoItem: 'Отменить: {step}',
    redoItem: 'Повторить: {step}',
    undoFailed: 'Отмена не удалась — подробности в консоли разработчика',
    redoFailed: 'Повтор не удался — подробности в консоли разработчика',
    undoFailedJournal:
      'Отмена не удалась: журнал действий Buba не записался — подробности в консоли разработчика',
    redoFailedJournal:
      'Повтор не удался: журнал действий Buba не записался — подробности в консоли разработчика',
    nothingToUndo: 'Отменять нечего: Buba отменяет перенос, переименование и удаление, сделанные в Buba',
    nothingToRedo: 'Повторять нечего',
    stepTrashOne: 'удаление «{name}»',
    stepTrashMany: {
      one: 'удаление {count} файла',
      few: 'удаление {count} файлов',
      many: 'удаление {count} файлов',
      other: 'удаление {count} файлов',
    },
    stepRenameOne: 'переименование «{from}» → «{to}»',
    stepRename: 'переименование',
    stepMoveTo: {
      one: 'перенос {count} файла в «{folder}»',
      few: 'перенос {count} файлов в «{folder}»',
      many: 'перенос {count} файлов в «{folder}»',
      other: 'перенос {count} файлов в «{folder}»',
    },
    stepMoveRoot: {
      one: 'перенос {count} файла в корень хранилища',
      few: 'перенос {count} файлов в корень хранилища',
      many: 'перенос {count} файлов в корень хранилища',
      other: 'перенос {count} файлов в корень хранилища',
    },
    undone: 'Отменено: {step}',
    notUndone: 'Не отменено: {step}',
    redone: 'Повторено: {step}',
    notRedone: 'Не повторено: {step}',
    missedUndo: {
      one: 'Не возвращено: {count} файл',
      few: 'Не возвращено: {count} файла',
      many: 'Не возвращено: {count} файлов',
      other: 'Не возвращено: {count} файла',
    },
    missedRedo: {
      one: 'Не повторено: {count} файл',
      few: 'Не повторено: {count} файла',
      many: 'Не повторено: {count} файлов',
      other: 'Не повторено: {count} файла',
    },
    quotedPath: '«{path}»',
    pathReason: '«{path}» — {reason}',
    pathTaken: '«{from}» → «{to}» — имя уже занято',
    goneMissing: 'файла там уже нет',
    goneChanged: 'там теперь другой файл',
    goneTaken: 'имя уже занято',
    restoreMissing: 'в корзине Obsidian его уже нет',
    restoreChanged: 'в корзине Obsidian на его месте другой файл',
    restoreTaken: 'на прежнем месте уже есть файл с таким именем',
    placeWindows: 'в Корзине Windows',
    placeMac: 'в Корзине',
    placeIos: 'в приложении «Файлы» → «Недавно удалённые»',
    placeOther: 'в корзине системы',
    deletedFilesSetting: 'Настройки → Файлы и ссылки → «Удалённые файлы»',
    systemOne:
      '«{name}» — в корзине системы: Buba не достаёт файлы оттуда. Восстановите его {place} — файл вернётся в «{folder}», метки Buba — вместе с ним',
    systemOneRoot:
      '«{name}» — в корзине системы: Buba не достаёт файлы оттуда. Восстановите его {place} — файл вернётся в корень хранилища, метки Buba — вместе с ним',
    systemMany: {
      one: 'В корзине системы: {count} файл — Buba не достаёт файлы оттуда. Восстановите их {place} — файлы вернутся на прежние места, метки Buba — вместе с ними',
      few: 'В корзине системы: {count} файла — Buba не достаёт файлы оттуда. Восстановите их {place} — файлы вернутся на прежние места, метки Buba — вместе с ними',
      many: 'В корзине системы: {count} файлов — Buba не достаёт файлы оттуда. Восстановите их {place} — файлы вернутся на прежние места, метки Buba — вместе с ними',
      other:
        'В корзине системы: {count} файла — Buba не достаёт файлы оттуда. Восстановите их {place} — файлы вернутся на прежние места, метки Buba — вместе с ними',
    },
    foreverOne: '«{name}» удалён навсегда — так задано в Obsidian ({setting}), вернуть его нельзя',
    foreverMany: {
      one: 'Удалено навсегда: {count} файл — так задано в Obsidian ({setting}), вернуть их нельзя',
      few: 'Удалено навсегда: {count} файла — так задано в Obsidian ({setting}), вернуть их нельзя',
      many: 'Удалено навсегда: {count} файлов — так задано в Obsidian ({setting}), вернуть их нельзя',
      other: 'Удалено навсегда: {count} файла — так задано в Obsidian ({setting}), вернуть их нельзя',
    },
    missingOne: '«{name}» — в корзине Obsidian (папка {folder}) не найден',
    missingMany: {
      one: 'В корзине Obsidian (папка {folder}) не найдено: {count} файл',
      few: 'В корзине Obsidian (папка {folder}) не найдено: {count} файла',
      many: 'В корзине Obsidian (папка {folder}) не найдено: {count} файлов',
      other: 'В корзине Obsidian (папка {folder}) не найдено: {count} файла',
    },
    unknownOne:
      '«{name}» — не в корзине Obsidian: он в корзине системы или удалён навсегда, как задано в Obsidian ({setting})',
    unknownMany: {
      one: 'Не в корзине Obsidian: {count} файл — они в корзине системы или удалены навсегда, как задано в Obsidian ({setting})',
      few: 'Не в корзине Obsidian: {count} файла — они в корзине системы или удалены навсегда, как задано в Obsidian ({setting})',
      many: 'Не в корзине Obsidian: {count} файлов — они в корзине системы или удалены навсегда, как задано в Obsidian ({setting})',
      other:
        'Не в корзине Obsidian: {count} файла — они в корзине системы или удалены навсегда, как задано в Obsidian ({setting})',
    },
    unseen: {
      one: 'Не видно в Obsidian: {count} файл — на диске он на месте; перезапустите Obsidian, чтобы он его увидел',
      few: 'Не видно в Obsidian: {count} файла — на диске они на месте; перезапустите Obsidian, чтобы он их увидел',
      many: 'Не видно в Obsidian: {count} файлов — на диске они на месте; перезапустите Obsidian, чтобы он их увидел',
      other:
        'Не видно в Obsidian: {count} файла — на диске они на месте; перезапустите Obsidian, чтобы он их увидел',
    },

    adding: 'Добавляется {index} из {total}…',
    nothingAdded: 'Ничего не добавлено',
    added: 'Добавлено файлов: {count} — в «{folder}»',
    addedTagged: 'Добавлено файлов: {count} — в «{folder}», метка «{tag}»',
    addedNotTagged: 'Добавлено файлов: {count} — в «{folder}», метка «{tag}» не поставлена — {reason}',
    addedSourceRefused: 'Добавлено файлов: {count} — в «{folder}», источник не принял файлы: {error}',
    namedReason: '«{name}» — {reason}',
    notAdded: 'Файлы не добавлены: {error}',
    addFiles: 'Добавить файлы',
    addFilesHere: 'Добавить файлы сюда…',
    addPhotos: 'Добавить фото и видео',
    photosHere: 'Сюда: фото и видео…',
    filesHere: 'Сюда: файлы…',
    pickNotOpened:
      'Окно выбора файлов открывается только по нажатию: откройте папку в Buba и нажмите значок «{action}» в шапке сетки.',
  },
};

export const t = translator(strings);
