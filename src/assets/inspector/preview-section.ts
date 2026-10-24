// File panel sections "preview" (order 10) and "resolution" (order 25): an image preview, a video frame or
// the embedded PSD and AI thumbnail, and the original's size, from the device preview store (for PSD the
// document size, for AI the artboard or thumbnail size); video and audio also get a duration. The panel never
// reads the original's pixels and puts only the preview's `blob:` URL into `<img>`. The duration is read by a
// hidden muted `<video>` that loads only the original's metadata from `getResourcePath`, like the preview
// builder (src/platform/media/duration.ts).
import { setIcon, type Plugin, type TFile } from 'obsidian';
import { formatFamily } from '../../core/format/family.ts';
import { t } from '../../core/i18n/dict/inspector.ts';
import { mediaDuration } from '../../platform/media/duration.ts';
import { previewKind } from '../../platform/previews/plan.ts';
import { previewStore, type PreviewStore } from '../../platform/previews/store.ts';
import { formatDuration, mediaKind } from './format.ts';
import { previewState, resolutionText } from './preview.ts';
import type { InspectorSection } from './sections.ts';

export const PREVIEW_SECTION_ID = 'buba-preview';
export const RESOLUTION_SECTION_ID = 'buba-resolution';

/** How many durations the panel remembers: on a phone it redraws on every tile tap. */
const DURATIONS_KEPT = 500;

export function previewSections(plugin: Plugin): InspectorSection[] {
  const durations = durationMemory();
  return [
    {
      id: PREVIEW_SECTION_ID,
      order: 10,
      // For several files: the first file's preview with "and N more" below.
      render(el, paths) {
        const [first] = paths;
        if (first === undefined) return;
        const store = previewStore(plugin);
        return live(store, el, first, () => {
          const file = plugin.app.vault.getFileByPath(first);
          const kind = file ? previewKind(file.extension) : null;
          const preview = store.get(first);
          const state = previewState(kind, preview);
          const image = state === 'image' ? preview : undefined;
          const frame = el.createDiv({
            cls: image ? 'buba-inspector-preview mod-image' : 'buba-inspector-preview',
          });
          if (image) frame.createEl('img', { attr: { src: image.url } });
          // The icon follows the format family, as on the tile, for any file: a pen for AI, an image file for
          // PSD, an archive for ZIP, a text page for MD; images and video keep "image" and "film". A file
          // outside the family table gets `file`. First lines of MD and TXT are a tile feature; the panel
          // shows the icon.
          else setIcon(frame, file ? formatFamily(file.extension).icon : 'file');
          // Ask even with a preview ready: after a file edit `get` returns the old one until `want` builds
          // the new one.
          if (kind) store.want([first]);
          if (paths.length > 1)
            el.createDiv({ cls: 'buba-inspector-more', text: t('moreFiles', { count: paths.length - 1 }) });
        });
      },
    },
    {
      id: RESOLUTION_SECTION_ID,
      order: 25,
      // Resolution and duration are for one file only; for several files the section is hidden so no empty
      // strip is left (there is no total duration; Obsidian does not show one either).
      render(el, paths) {
        const [only] = paths;
        if (only === undefined || paths.length > 1) {
          el.hide();
          return;
        }
        const store = previewStore(plugin);
        const file = plugin.app.vault.getFileByPath(only);
        const media = file ? mediaKind(file.extension) : null;
        // Duration: `undefined` while reading, `null` if it could not be read; both show "—".
        let seconds = file && media ? durations.get(file) : null;
        const draw = () => {
          const rows = el.createDiv({ cls: 'buba-inspector-rows' });
          // Audio has no resolution.
          if (media !== 'audio') {
            rows.createDiv({ cls: 'buba-inspector-label', text: t('labelResolution') });
            // A PDF page has no pixel size, and the preview size is not the original's size.
            const pdf = file !== null && previewKind(file.extension) === 'pdf';
            rows.createDiv({
              cls: 'buba-inspector-value',
              text: (pdf ? null : resolutionText(store.get(only))) ?? '—',
            });
          }
          if (media) {
            rows.createDiv({ cls: 'buba-inspector-label', text: t('labelDuration') });
            rows.createDiv({
              cls: 'buba-inspector-value',
              text: typeof seconds === 'number' ? formatDuration(seconds) : '—',
            });
          }
        };
        const off = live(store, el, only, draw);
        if (!file || seconds !== undefined) return off;
        // Cleaning up the section (another file picked or the panel closed) aborts the read.
        const reading = new AbortController();
        void mediaDuration(plugin.app.vault.getResourcePath(file), reading.signal).then((answer) => {
          if (reading.signal.aborted) return;
          if (answer !== null) durations.set(file, answer);
          seconds = answer;
          el.empty();
          draw();
        });
        return () => {
          reading.abort();
          off();
        };
      },
    },
  ];
}

/**
 * Durations already read: path → `mtime`, size and seconds, at most `DURATIONS_KEPT`, oldest evicted first. A
 * changed file has no entry and is read again; failures are not remembered.
 */
function durationMemory() {
  const kept = new Map<string, { mtime: number; size: number; seconds: number }>();
  return {
    get(file: TFile): number | undefined {
      const entry = kept.get(file.path);
      return entry && entry.mtime === file.stat.mtime && entry.size === file.stat.size
        ? entry.seconds
        : undefined;
    },
    set(file: TFile, seconds: number): void {
      kept.delete(file.path);
      kept.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, seconds });
      for (const path of kept.keys()) {
        if (kept.size <= DURATIONS_KEPT) break;
        kept.delete(path);
      }
    },
  };
}

/**
 * Draws the section and redraws it when the path's preview becomes ready or is removed (then the icon and
 * "—"); returns the unsubscribe, which is the section cleanup.
 */
function live(store: PreviewStore, el: HTMLElement, path: string, draw: () => void): () => void {
  draw();
  const redraw = () => {
    el.empty();
    draw();
  };
  const offReady = store.onReady((ready) => {
    if (ready === path && store.get(path)) redraw();
  });
  const offRemoved = store.onRemoved((removed) => {
    if (removed === path) redraw();
  });
  return () => {
    offReady();
    offRemoved();
  };
}
