// Folder cover items in the grid tile menu (`file-menu` with source `buba-grid`, file-menu.ts), section
// `view` like the tree's "Folder color…" and "Folder icon…": on a folder tile "Upload cover…" (the system
// file picker, images only; on iPhone the Photos library arrives as JPEG) and, while it has one, "Move cover"
// (drag and zoom it in the tile, cover-frame.ts), "Center cover" once it was moved and "Remove cover"; a new or
// removed cover starts in the middle again. On an image tile "Make folder cover" for the folder the image lies in. Only one tile: a menu for
// several files has no cover items. The tree shows no covers and its menu has no cover items. The cover file is
// written first (src/platform/covers.ts), then the storage line; the cover it replaces goes to the trash once
// no folder names it. Without storage (journals failed to load) there are no cover items.
import {
  Notice,
  Platform,
  TFile,
  TFolder,
  type App,
  type Menu,
  type Plugin,
  type TAbstractFile,
} from 'obsidian';
import { t } from '../../core/i18n/dict/actions.ts';
import { MIDDLE } from '../../core/layout/cover-frame.ts';
import { coverFrameText, type CoverFrame, type FolderLooks } from '../../core/storage/types.ts';
import { trashCover, vaultPicture, writeCover } from '../../platform/covers.ts';
import { pickFiles } from '../../platform/files/pick.ts';
import { ownTitle } from '../../platform/menu-title.ts';
import { previewKind } from '../../platform/previews/plan.ts';
import type { BubaAssets } from '../api.ts';
import { MENU_SOURCE } from './file-menu.ts';

/**
 * Picture types for "Upload cover…": on iPhone the types without HEIC, so iOS converts Photos items to JPEG
 * (as `PHOTOS_AND_VIDEOS` in src/platform/files/pick.ts); elsewhere any image the engine decodes.
 */
const coverTypes = (): string =>
  Platform.isIosApp ? 'image/jpeg,image/png,image/gif,image/webp' : 'image/*';

export function registerCoverMenu(plugin: Plugin, assets: BubaAssets): void {
  const { app } = plugin;
  const storage = (plugin as Plugin & { storage?: FolderLooks }).storage;
  if (!storage) return;
  plugin.registerEvent(
    app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile, source: string) => {
      if (source !== MENU_SOURCE) return;
      if (file instanceof TFolder && !file.isRoot()) folderItems(app, assets, storage, menu, file);
      else if (
        file instanceof TFile &&
        previewKind(file.extension) === 'image' &&
        file.parent &&
        !file.parent.isRoot()
      )
        imageItem(app, storage, menu, file, file.parent);
    }),
  );
}

function folderItems(app: App, assets: BubaAssets, storage: FolderLooks, menu: Menu, folder: TFolder): void {
  menu.addItem((item) =>
    item
      .setSection('view')
      .setTitle(ownTitle(t('uploadCover')))
      .setIcon('image-up')
      .onClick(() => {
        const opened = pickFiles(activeWindow, coverTypes(), ([picture]) => {
          if (picture) void setCover(app, storage, folder, () => writeCover(app, picture));
        });
        if (!opened) new Notice(t('coverPickNotOpened', { action: t('uploadCover') }), 10_000);
      }),
  );
  const look = storage.folderLook(folder.path);
  if (look.cover === null) return;
  // "Move cover" works in the grid that shows the tile: the first open grid that has it.
  menu.addItem((item) =>
    item
      .setSection('view')
      .setTitle(ownTitle(t('moveCover')))
      .setIcon('move')
      .onClick(() => moveCover(assets, storage, folder)),
  );
  if (look.frame !== null)
    menu.addItem((item) =>
      item
        .setSection('view')
        .setTitle(ownTitle(t('centerCover')))
        .setIcon('scan')
        .onClick(() => void storage.setFolderFrame(folder.path, null).catch(() => undefined)),
    );
  menu.addItem((item) =>
    item
      .setSection('view')
      .setTitle(ownTitle(t('removeCover')))
      .setIcon('image-off')
      .onClick(() => void removeCover(app, storage, folder)),
  );
}

function imageItem(app: App, storage: FolderLooks, menu: Menu, file: TFile, folder: TFolder): void {
  menu.addItem((item) =>
    item
      .setSection('view')
      .setTitle(ownTitle(t('makeCover')))
      .setIcon('image')
      .onClick(
        () => void setCover(app, storage, folder, async () => writeCover(app, await vaultPicture(app, file))),
      ),
  );
}

/**
 * Writes the cover file, then the folder's cover line; the replaced cover goes to the trash when unused. The
 * folder path is read after the file is written: a rename meanwhile gives the cover to the new path.
 */
async function setCover(
  app: App,
  storage: FolderLooks,
  folder: TFolder,
  write: () => Promise<string>,
): Promise<void> {
  let name: string | null = null;
  try {
    name = await write();
    const old = storage.folderLook(folder.path).cover;
    await storage.setFolderCover(folder.path, name);
    // A new picture starts in the middle: the old frame was for the old one.
    if (name !== old) await storage.setFolderFrame(folder.path, null);
    if (old !== null && !storage.coverInUse(old)) await trashCover(app, old);
  } catch (error) {
    console.error('Buba: folder cover not set', error);
    new Notice(t('coverFailed', { folder: folder.name, error: reason(error) }));
    // A written file no folder names is not left behind.
    if (name !== null && !storage.coverInUse(name)) await trashCover(app, name).catch(() => undefined);
  }
}

/**
 * "Move cover": the hint stays up while the tile takes the gesture; the kept frame goes to the folder look,
 * the middle as no frame at all.
 */
function moveCover(assets: BubaAssets, storage: FolderLooks, folder: TFolder): void {
  const hint = new Notice(t('moveCoverHint'), 0);
  const done = (frame: CoverFrame | null): void => {
    hint.hide();
    if (!frame) return;
    const text = coverFrameText(frame);
    storage
      .setFolderFrame(folder.path, text === coverFrameText(MIDDLE) ? null : text)
      .catch((error: unknown) => {
        console.error('Buba: cover position not saved', error);
        new Notice(t('coverFrameFailed', { folder: folder.name, error: reason(error) }));
      });
  };
  if (!assets.gridViews().some((view) => view.frameCover?.(folder.path, done))) hint.hide();
}

async function removeCover(app: App, storage: FolderLooks, folder: TFolder): Promise<void> {
  try {
    const old = storage.folderLook(folder.path).cover;
    await storage.setFolderCover(folder.path, null);
    await storage.setFolderFrame(folder.path, null);
    if (old !== null && !storage.coverInUse(old)) await trashCover(app, old);
  } catch (error) {
    console.error('Buba: folder cover not removed', error);
    new Notice(t('coverRemoveFailed', { folder: folder.name }));
  }
}

/** A short reason for the notice: the error's message, else its text. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
