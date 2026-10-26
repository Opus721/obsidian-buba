// Folder cover files: a picture chosen on disk or a vault image, downscaled to at most `COVER_SIDE` px on the
// longer side and written once as a new file in `__buba-data/covers` under a random name, so two devices never
// write the same file and sync has nothing to merge. The grid shows the cover through the device preview
// store like any picture (src/assets/grid/folder-faces.ts). WebP where the engine encodes it; iPhone WebKit
// does not, there JPEG. A cover nobody uses any more goes to Obsidian's trash, as the user set it up.
import { TFile, type App } from 'obsidian';
import { COVERS_DIR, coverPath } from '../core/storage/types.ts';
import { fitSize } from './previews/plan.ts';

/** Longer side of a cover file, px: twice the largest preview, so a cover stays sharp if previews grow. */
export const COVER_SIDE = 1024;
const QUALITY = 0.85;

/** A random cover name without the extension: 16 characters `[a-z0-9]` (`isCoverName`). */
function randomName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join('');
}

/** Downscales picture `source` and encodes it: the bytes and the file extension. */
export async function coverBytes(source: Blob): Promise<{ data: ArrayBuffer; ext: 'webp' | 'jpg' }> {
  const bitmap = await createImageBitmap(source);
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('picture has no size');
    const fit = fitSize(bitmap.width, bitmap.height, COVER_SIDE);
    const canvas = new OffscreenCanvas(fit.width, fit.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d OffscreenCanvas context');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, fit.width, fit.height);
    // WebKit answers a WebP request with PNG: the answer's own type decides, and JPEG takes its place.
    const webp = await canvas.convertToBlob({ type: 'image/webp', quality: QUALITY });
    if (webp.type === 'image/webp') return { data: await webp.arrayBuffer(), ext: 'webp' };
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
    return { data: await jpeg.arrayBuffer(), ext: 'jpg' };
  } finally {
    bitmap.close();
  }
}

/** Writes a new cover file from picture `source`; returns its name for `setFolderCover`. */
export async function writeCover(app: App, source: Blob): Promise<string> {
  const { data, ext } = await coverBytes(source);
  const { vault } = app;
  if (!vault.getFolderByPath(COVERS_DIR)) {
    try {
      await vault.createFolder(COVERS_DIR);
    } catch (error) {
      // Created meanwhile, or known to the disk before the vault saw it: only a missing folder is a failure.
      if (!(await vault.adapter.exists(COVERS_DIR))) throw error;
    }
  }
  const name = `${randomName()}.${ext}`;
  await vault.createBinary(coverPath(name), data);
  return name;
}

/** A vault image as a picture for `writeCover`. */
export async function vaultPicture(app: App, file: TFile): Promise<Blob> {
  return new Blob([await app.vault.readBinary(file)]);
}

/** Cover file `name` goes to the trash; a missing one is fine. */
export async function trashCover(app: App, name: string): Promise<void> {
  const file = app.vault.getFileByPath(coverPath(name));
  if (file) await app.fileManager.trashFile(file);
}
