// Folder tile faces for the grid (tiles.ts `FolderFace`): the folder's look from storage, as the Buba tree
// shows it (its icon, color and contrast classes), and the picture of the tile. The picture is the cover when
// its file is in the vault; without a cover the folder is empty in its look, like its tree row. Only with
// "Cover from contents" (`folderAutoCover`) a plain folder without a cover shows its first picture: the image
// added last among its own files, as the grid's default sort ("Date added", newest first) puts it first, else
// among files in its subfolders; only when it has no images, a video frame the same way. `peeks` are the files that
// lie in the "with files inside" folder: up to three newest, own first, then from subfolders, images before
// video frames, then other files (documents show as pages). With "One picture, the cover" (`one`) the folder
// holds a single card and no picture of its own: its cover, else the first of those files. Faces are cached per grid
// view and dropped whole by the view on any change: a folder look, a cover file arriving or leaving (sync
// brings the journal line and the file separately), the file index. No subscriptions here: the view owns
// them, so they end with it.
import { Platform, type TAbstractFile, type Vault } from 'obsidian';
import { colorCss } from '../../core/color/value.ts';
import { folderIcon } from '../../core/icon/choices.ts';
import {
  COVERS_DIR,
  coverPath,
  parseCoverFrame,
  type FolderLook,
  type FolderLooks,
} from '../../core/storage/types.ts';
import type { FileIndex, FileRecord } from '../../platform/files/file-index.ts';
import { previewBuilds, previewKind } from '../../platform/previews/plan.ts';
import { contrastClasses } from '../color/dot.ts';
import type { FolderFace } from './tiles.ts';

const NO_LOOK: FolderLook = { color: null, icon: null, cover: null, frame: null };

/** A cover file: a file directly in the covers folder (`__buba-data/covers`). */
export const isCoverFile = (file: TAbstractFile): boolean =>
  file.path.startsWith(`${COVERS_DIR}/`) && !file.path.slice(COVERS_DIR.length + 1).includes('/');

export class FolderFaces {
  readonly #vault: Vault;
  readonly #index: FileIndex;
  readonly #storage: FolderLooks | undefined;
  readonly #auto: () => boolean;
  readonly #one: () => boolean;
  readonly #cache = new Map<string, FolderFace>();

  /** `auto`: the "Cover from contents" setting; `one`: "One picture, the cover"; both read on each build. */
  constructor(
    vault: Vault,
    index: FileIndex,
    storage: FolderLooks | undefined,
    auto: () => boolean = () => false,
    one: () => boolean = () => false,
  ) {
    this.#vault = vault;
    this.#index = index;
    this.#storage = storage;
    this.#auto = auto;
    this.#one = one;
  }

  /** The face of folder `path`, from the cache. */
  face(path: string): FolderFace {
    let face = this.#cache.get(path);
    if (!face) this.#cache.set(path, (face = this.#build(path)));
    return face;
  }

  /** Something a face depends on changed: faces are built again on the next ask. */
  clear(): void {
    this.#cache.clear();
  }

  #build(path: string): FolderFace {
    const look = this.#storage?.folderLook(path) ?? NO_LOOK;
    const cover = look.cover === null ? null : coverPath(look.cover);
    const own = look.color !== null || look.icon !== null;
    const covered = cover !== null && this.#vault.getFileByPath(cover) !== null;
    const peeks = peekFiles(this.#index, path);
    if (this.#one())
      return {
        icon: folderIcon(look.icon, () => true),
        color: colorCss(look.color),
        contrast: contrastClasses(look.color),
        picture: null,
        cover: false,
        frame: null,
        peeks: covered ? [cover] : peeks.slice(0, 1),
      };
    return {
      // Icons come only from the icon window, which lists the icons Obsidian has.
      icon: folderIcon(look.icon, () => true),
      color: colorCss(look.color),
      contrast: contrastClasses(look.color),
      picture: covered ? cover : own || !this.#auto() ? null : firstPicture(this.#index, path),
      cover: covered,
      frame: covered && look.frame !== null ? parseCoverFrame(look.frame) : null,
      peeks,
    };
  }
}

/** The folder's first picture: own images, images below, own videos, videos below; newest added first. */
function firstPicture(index: FileIndex, folder: string): string | null {
  const own = index.filesIn(folder, false);
  const below = (): FileRecord[] => index.filesIn(folder, true);
  return (
    newest(own, 'image') ??
    newest(below(), 'image') ??
    newest(own, 'video') ??
    newest(below(), 'video') ??
    null
  );
}

/** Up to three files in the folder, newest first: own images, images below, then videos, then other files. */
function peekFiles(index: FileIndex, folder: string): string[] {
  const own = index.filesIn(folder, false);
  const mine = new Set(own);
  const below = index.filesIn(folder, true).filter((record) => !mine.has(record));
  const picked: string[] = [];
  for (const kind of ['image', 'video', 'other'] as const)
    for (const records of [own, below]) {
      if (picked.length >= PEEKS) return picked;
      picked.push(...newestFew(records, kind, PEEKS - picked.length));
    }
  return picked;
}

const PEEKS = 3;

/** `other` is any file that is neither an image nor a video frame, with or without a preview of its own. */
function newestFew(
  records: readonly FileRecord[],
  kind: 'image' | 'video' | 'other',
  count: number,
): string[] {
  return records
    .filter((record) => (kind === 'other' ? isOther(record) : isPicture(record, kind)))
    .sort((a, b) => b.ctime - a.ctime || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, count)
    .map((record) => record.path);
}

const isPicture = (record: FileRecord, kind: 'image' | 'video'): boolean =>
  previewKind(record.ext) === kind && previewBuilds(record.ext, Platform.isIosApp);

const isOther = (record: FileRecord): boolean => {
  const kind = previewKind(record.ext);
  return kind !== 'image' && kind !== 'video';
};

function newest(records: readonly FileRecord[], kind: 'image' | 'video'): string | undefined {
  let best: FileRecord | undefined;
  for (const record of records) {
    if (previewKind(record.ext) !== kind || !previewBuilds(record.ext, Platform.isIosApp)) continue;
    if (!best || record.ctime > best.ctime || (record.ctime === best.ctime && record.path < best.path))
      best = record;
  }
  return best?.path;
}
