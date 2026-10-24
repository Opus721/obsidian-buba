// Creating a folder from the Buba tree. The name dialog is the same as for "New tag…" (`NameModal`,
// src/assets/tags/group-modals.ts): a "Name" field with a free "Untitled" preselected, Enter and "Create"
// create, Esc does nothing. The name rule is in src/core/actions/new-folder.ts; a refusal shows a notice and
// the dialog stays. Creation uses the public `vault.createFolder`: Obsidian's ready-made "create Untitled
// folder" and free-name lookup are internal. Its failure ("Folder already exists.", e.g. "Lamp" and "lamp"
// are one name on Windows) becomes a clear notice and no folder. The "+ New folder" row at the bottom of the
// tree matches "+ New tag" under the tags (tag-list.ts): a plus in the icon cell and the name in muted text
// via Obsidian's `u-muted` class, no CSS of our own.
import { Notice, setIcon, type App, type Menu } from 'obsidian';
import { newFolderTarget, ROOT, untitledFolderName } from '../../core/actions/new-folder.ts';
import { t } from '../../core/i18n/dict/tree.ts';
import { NameModal } from '../tags/group-modals.ts';

/** Names of everything in folder `parent`, files and folders: on disk they share one namespace. */
function siblingsOf(app: App, parent: string): string[] {
  const folder = parent === ROOT ? app.vault.getRoot() : app.vault.getFolderByPath(parent);
  return (folder?.children ?? []).map((child) => child.name);
}

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** The name dialog for a new folder in `parent`; on success `created` gets its path. */
export function openNewFolder(app: App, parent: string, created: (path: string) => void): void {
  const title = parent === ROOT ? t('newFolder') : t('newFolderIn', { name: nameOf(parent) });
  new NameModal(
    app,
    title,
    untitledFolderName(siblingsOf(app, parent)),
    t('create'),
    (text) => {
      const target = newFolderTarget(parent, text, siblingsOf(app, parent));
      if (!target.ok) {
        new Notice(target.why);
        return false;
      }
      void create(app, target.path, target.name, created);
      return true;
    },
    t('name'),
  ).open();
}

async function create(app: App, path: string, name: string, created: (path: string) => void): Promise<void> {
  try {
    await app.vault.createFolder(path);
  } catch (error) {
    console.error('Buba: folder not created', error);
    const taken = /already exists/i.test(error instanceof Error ? error.message : String(error));
    new Notice(taken ? t('folderNameTaken', { name }) : t('folderCreateFailed', { name }));
    return;
  }
  created(path);
}

/** "New folder…" item of the "All files" and empty-space tree menus; the ellipsis says it opens a dialog. */
export function addNewFolderItem(menu: Menu, open: () => void): void {
  menu.addItem((item) => item.setTitle(t('newFolderItem')).setIcon('folder-plus').onClick(open));
}

/** The "+ New folder" row, last in `container`; a click (a tap on a phone) calls `open`. */
export function drawNewFolderRow(container: HTMLElement, open: () => void): HTMLElement {
  const self = container
    .createDiv({ cls: 'tree-item' })
    .createDiv({ cls: 'tree-item-self is-clickable', attr: { role: 'button' } });
  setIcon(self.createDiv({ cls: 'buba-tree-icon', attr: { 'aria-hidden': 'true' } }), 'plus');
  self.createDiv({ cls: 'tree-item-inner u-muted', text: t('newFolder') });
  self.addEventListener('click', () => open());
  return self;
}
