// "Add files" through the system file picker: chosen files go through the same write as drop and
// paste (`importInto`, `gridTarget`): into the open folder, the attachments folder for "All files",
// the folder before another source (an open tag also tags the files); from a folder menu, into that
// folder, untagged. On a phone the grid has no header icons, so the items live in the grid's "More"
// menu (`buba:grid-menu` event, view.ts) and the folder menu: "photos and videos" (arrive as JPEG)
// and "files" (as they are); on Android only "files" (`ways`). On desktop and tablet: the
// `image-plus` icon in the grid view header, a folder menu item and a command; the picker opens
// directly. In the Buba tree folder menu the item goes on top, via the tree's `buba:folder-menu`
// event before its own items and `file-menu`; in Obsidian's file explorer and on a folder tile via
// `file-menu`. Items carry the "Buba" label on the right in both menus (src/platform/menu-title.ts).
import {
  ItemView,
  Notice,
  Platform,
  TFolder,
  type App,
  type Events,
  type IconName,
  type Menu,
  type Plugin,
} from 'obsidian';
import { t } from '../../core/i18n/dict/actions.ts';
import { FOLDER_MENU, GRID_MENU } from '../../core/layout/grid-events.ts';
import { PHOTOS_AND_VIDEOS, pickFiles } from '../../platform/files/pick.ts';
import { ownTitle } from '../../platform/menu-title.ts';
import type { BubaAssets } from '../api.ts';
import type { GridLeafView } from '../grid/selection.ts';
import { gridTarget, importInto, type GridTarget } from './import-drop.ts';

/**
 * The picker did not open without a real user gesture (`pickFiles`): a native Obsidian menu item on desktop,
 * a command from the command line or a link. The reason is not named: there are several.
 */
const notOpened = (): string => t('pickNotOpened', { action: t('addFiles') });

/**
 * A way to pick: label in the grid header and menu, label in the folder menu, command, icon and file types.
 * Labels are dictionary keys, so the text is taken at render time in the Buba language.
 */
interface Way {
  title: 'addFiles' | 'addPhotos';
  here: 'addFilesHere' | 'photosHere' | 'filesHere';
  command: { id: string; name: 'commandAddFiles' | 'commandAddPhotos' };
  icon: IconName;
  accept: string | null;
}

const FILES: Way = {
  title: 'addFiles',
  here: 'addFilesHere',
  command: { id: 'add-files', name: 'commandAddFiles' },
  icon: 'image-plus',
  accept: null,
};
// On a phone both items open the same iOS sheet; the difference is what arrives: Photos library items come as
// JPEG, files as they are. The label says what is added, not the format (messengers split "gallery" and
// "document" the same way). The verb stays because the "More" menu holds other grid actions. The folder menu
// label is shorter: Obsidian truncates a long "Add … here…" with an ellipsis on a 375 px wide iPhone.
const PHOTOS: Way = {
  title: 'addPhotos',
  here: 'photosHere',
  command: { id: 'add-photos', name: 'commandAddPhotos' },
  icon: 'image-plus',
  accept: PHOTOS_AND_VIDEOS,
};
const ANY_FILES: Way = {
  ...FILES,
  here: 'filesHere',
  icon: 'file-plus',
};

/**
 * Ways per platform: both on iPhone, "photos and videos" first; only "files" on Android
 * phones, because a typed input there opens the system photo picker, which hides HEIC,
 * gives numeric names and re-encodes HEVC video unreadably; an untyped picker opens Android
 * Files with Images and Videos sections, everything as is, and Android has no JPEG
 * conversion that would justify two items. On desktop and tablet the picker opens directly.
 */
function ways(): Way[] {
  if (!Platform.isPhone) return [FILES];
  return Platform.isAndroidApp ? [ANY_FILES] : [PHOTOS, ANY_FILES];
}

export function registerImportPick(plugin: Plugin, assets: BubaAssets): void {
  const { app } = plugin;
  const { workspace } = app;
  const grids = (): GridLeafView[] =>
    assets.gridViews().filter((view): view is GridLeafView => view instanceof ItemView);
  const intoGrid = (view: GridLeafView, way: Way): void =>
    pick(app, view.containerEl.win, gridTarget(view, assets), way);

  if (!Platform.isPhone) {
    // One header icon per view; the module finds grid views on `layout-change`, like the selection module.
    const marked = new WeakSet<GridLeafView>();
    const install = (): void => {
      for (const view of grids()) {
        if (marked.has(view)) continue;
        marked.add(view);
        view.addAction(FILES.icon, t(FILES.title), () => intoGrid(view, FILES));
      }
    };
    workspace.onLayoutReady(install);
    plugin.registerEvent(workspace.on('layout-change', install));
  }

  plugin.registerEvent(
    (workspace as Events).on(GRID_MENU, (...data: unknown[]) => {
      const [menu, target] = data as [Menu, unknown];
      const view = grids().find((each) => each === target);
      if (!view) return;
      for (const way of ways()) {
        menu.addItem((item) =>
          item
            .setSection('action')
            .setTitle(ownTitle(t(way.title)))
            .setIcon(way.icon)
            .onClick(() => intoGrid(view, way)),
        );
      }
    }),
  );

  // A menu that already got the items from `buba:folder-menu` does not repeat them on its `file-menu`.
  const filled = new WeakSet<Menu>();
  const addHere = (menu: Menu, file: unknown): void => {
    if (!(file instanceof TFolder) || filled.has(menu)) return;
    filled.add(menu);
    for (const way of ways()) {
      menu.addItem((item) =>
        item
          .setSection('action-primary')
          .setTitle(ownTitle(t(way.here)))
          .setIcon(way.icon)
          .onClick(() => pick(app, activeWindow, { folder: file.path }, way)),
      );
    }
  };
  plugin.registerEvent(
    (workspace as Events).on(FOLDER_MENU, (...data: unknown[]) => {
      const [menu, folder] = data as [Menu, unknown];
      addHere(menu, folder);
    }),
  );
  plugin.registerEvent(workspace.on('file-menu', (menu, file) => addHere(menu, file)));

  // The command targets the open grid: the most recent leaf of the main area.
  for (const way of ways()) {
    plugin.addCommand({
      id: way.command.id,
      name: t(way.command.name),
      checkCallback: (checking) => {
        const leaf = workspace.getMostRecentLeaf();
        const view = grids().find((each) => each.leaf === leaf);
        if (!view) return false;
        if (!checking) intoGrid(view, way);
        return true;
      },
    });
  }
}

/** Opens the picker and writes the chosen files where `target` says; reports if the picker did not open. */
function pick(app: App, win: Window, target: GridTarget, way: Way): void {
  const opened = pickFiles(win, way.accept, (files) => {
    const items = files.map((file) => ({ name: file.name, type: file.type, data: file }));
    const { folder, accept, view } = target;
    void importInto(app, folder, { items, refused: [] }, { progress: true, accept, view });
  });
  if (!opened) new Notice(notOpened(), 10_000);
}
