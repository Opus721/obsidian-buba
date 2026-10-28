// "New note", "New canvas" and "New base" in the menu of the grid's empty space (clipboard.ts), as in the
// folder menu of Obsidian's file explorer: the file is created at once under a free "Untitled" name in the
// folder the grid shows and opens in the same tab as a history step, like a double click on a tile ("back"
// returns to the grid). A note opens with its title selected for renaming, as Obsidian opens a new note; a
// canvas or a base is renamed from its tab header. A canvas starts empty, as Obsidian writes a new one; a
// base starts with one table view of the files in its folder (`file.inFolder`, Bases syntax), so it opens
// on a table of that folder and not of the whole vault; a base in the root shows the whole vault. Canvas and Bases are Obsidian's core plugins, not
// Buba's: the files are ordinary Obsidian files. A new file is an undo step: Ctrl+Z in the grid puts it into
// the trash while it is still empty, as made.
import { Notice, type App, type Menu, type OpenViewState } from 'obsidian';
import { availablePath } from '../../core/actions/import-names.ts';
import { ROOT } from '../../core/actions/new-folder.ts';
import { t } from '../../core/i18n/dict/actions.ts';
import { recordCreated } from '../../platform/files/undo.ts';
import { ownTitle } from '../../platform/menu-title.ts';

interface Kind {
  readonly extension: string;
  readonly title: 'newNoteItem' | 'newCanvasItem' | 'newBaseItem';
  readonly icon: string;
  readonly content: (folder: string) => string;
}

/** The kinds in menu order, with the icons Obsidian gives them. */
const KINDS: readonly Kind[] = [
  { extension: 'md', title: 'newNoteItem', icon: 'square-pen', content: () => '' },
  { extension: 'canvas', title: 'newCanvasItem', icon: 'layout-dashboard', content: () => '' },
  {
    extension: 'base',
    title: 'newBaseItem',
    icon: 'table',
    content: (folder) =>
      (folder === ROOT
        ? ''
        : `filters:\n  and:\n    - ${yamlQuoted(`file.inFolder(${JSON.stringify(folder)})`)}\n`) +
      `views:\n  - type: table\n    name: ${t('baseTableView')}\n`,
  },
];

/** A YAML single-quoted scalar: any text, quotes doubled. */
const yamlQuoted = (text: string): string => `'${text.replaceAll("'", "''")}'`;

/** Adds the three items to `menu` for `folder`, in the given section. */
export function addNewFileItems(menu: Menu, app: App, folder: string, section: string): void {
  for (const kind of KINDS)
    menu.addItem((item) =>
      item
        .setSection(section)
        .setTitle(ownTitle(t(kind.title)))
        .setIcon(kind.icon)
        .onClick(() => void createNewFile(app, folder, kind.extension)),
    );
}

/**
 * Creates a note, canvas or base (`extension` md, canvas or base) in `folder` under a free "Untitled" name,
 * compared without case, and opens it.
 */
export async function createNewFile(app: App, folder: string, extension: string): Promise<void> {
  const kind = KINDS.find((each) => each.extension === extension);
  const target = folder === ROOT ? app.vault.getRoot() : app.vault.getFolderByPath(folder);
  if (!kind || !target) return;
  const taken = new Set(target.children.map((child) => child.path.toLowerCase()));
  const name = `${t('untitled')}.${kind.extension}`;
  const path = availablePath(folder === ROOT ? '' : folder, name, (each) => taken.has(each.toLowerCase()));
  let file;
  try {
    file = await app.vault.create(path, kind.content(folder));
  } catch (error) {
    console.error('Buba: file not created', path, error);
    new Notice(t('newFileFailed', { name }));
    return;
  }
  recordCreated(app, 'file', '', [file.path]);
  const state: OpenViewState = kind.extension === 'md' ? { eState: { rename: 'all' } } : {};
  await app.workspace.getLeaf(false).openFile(file, state);
}
