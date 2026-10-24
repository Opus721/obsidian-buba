// Pure part of the file panel's preview and resolution sections: no `obsidian` import, tested with
// `node --test`. Previews and original sizes come from the device preview store (IndexedDB); the panel never
// reads the original.
import type { PreviewKind, Size } from '../../platform/previews/plan.ts';
import type { Preview } from '../../platform/previews/store.ts';

/** `image` has a preview, `waiting` is an image or video still being previewed, `none` gets no preview. */
export type PreviewState = 'image' | 'waiting' | 'none';

export function previewState(kind: PreviewKind | null, preview: Preview | null): PreviewState {
  if (preview) return 'image';
  return kind ? 'waiting' : 'none';
}

/** Original resolution as "1920 × 1080", or `null` without a preview. */
export function resolutionText(preview: Size | null): string | null {
  return preview ? `${preview.width} × ${preview.height}` : null;
}
