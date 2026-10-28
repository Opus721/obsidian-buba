// A file the grid opened in Obsidian's own view on a phone (a note, PDF, canvas, base or audio) replaces the grid
// in its tab, as from Obsidian's file explorer: "back" returns to the grid. Obsidian's view has no way to the
// folder's next file, and its "Close" (the ⋯ sheet) closes the whole tab, leaving an empty "New tab". So on a
// phone (word of the owner 27.10 22:12–22:13):
// - "previous" and "next" round arrows at mid-height, like the viewer's, page through the grid's files in grid
//   order, in the same tab (each a history step, as a link): every file Obsidian has a view for, images and video
//   included (Obsidian's own image and video views), so from a PDF one reaches the photos beside it, as the
//   viewer reaches the PDFs; files without an Obsidian view (PSD, Word) are skipped, as opening them in a tab
//   would hand them to the share sheet. None at the list edge, none for a file outside the list (reached by a
//   link). A tap on the file hides them and the next tap shows them, as in
//   the viewer; a tap on a link, button, field or the editor does not.
// - closing such a tab, when Obsidian leaves only an empty tab in its place, puts the grid back there with the
//   folder and view it had when the file was opened.
// An image or video tapped in the grid still opens Buba's own viewer, which pages and closes by itself.
import { Platform, setIcon, type FileView, type Plugin, type TFile, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../core/i18n/dict/viewer.ts';
import { GRID_VIEW_TYPE } from '../../core/layout/view-state.ts';
import { IMAGE_EXTS, VIDEO_EXTS } from '../../core/format/obsidian-types.ts';
import { opensInObsidian } from '../../core/viewer/default-app.ts';
import { neighbor } from '../../core/viewer/zoom.ts';
import type { GridLeafView } from '../grid/selection.ts';
import './pager.css';

/** A tab the grid opened a file in: the grid's state to go back to and the files to page through. */
interface Trip {
  grid: Record<string, unknown>;
  files: string[];
}

/** The file of a leaf's view: a note, PDF, canvas and the like are `FileView`s; the grid and an empty tab have none. */
const fileOf = (leaf: WorkspaceLeaf): TFile | null => (leaf.view as Partial<FileView>).file ?? null;

/** Whether Obsidian shows a file with this extension in a tab of its own. */
const hasView = (ext: string): boolean => opensInObsidian(ext) || IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);

/** How long after a tab closes Obsidian's empty tab still counts as its replacement. */
const CLOSE_MS = 1000;

/** Taps on these do their own thing: they neither hide nor show the arrows. */
const OWN_TAP =
  'a, button, input, select, textarea, audio, video, [contenteditable="true"], .clickable-icon, .view-header, .pdf-toolbar, .buba-pager-nav';

/**
 * Opens `file` from the grid `view` in Obsidian, in the tab the grid is in (Obsidian's `getLeaf(false)`), and
 * on a phone remembers the trip for the arrows and for closing.
 */
export type OpenFromGrid = (view: GridLeafView, file: TFile) => Promise<void>;

export function registerPager(plugin: Plugin): OpenFromGrid {
  const { vault, workspace } = plugin.app;
  const trips = new Map<WorkspaceLeaf, Trip>();
  /** A closed tab's trip, while its empty replacement may still appear. */
  let closed: { trip: Trip; at: number } | null = null;

  const sync = (): void => {
    if (!Platform.isPhone) return;
    const alive = new Set<WorkspaceLeaf>();
    workspace.iterateAllLeaves((leaf) => void alive.add(leaf));
    for (const [leaf, trip] of trips) {
      if (!alive.has(leaf)) {
        trips.delete(leaf);
        closed = { trip, at: performance.now() };
      } else if (leaf.view.getViewType() === GRID_VIEW_TYPE) trips.delete(leaf);
      else draw(leaf, trip);
    }
    if (closed && performance.now() - closed.at > CLOSE_MS) closed = null;
    const leaf = workspace.getMostRecentLeaf();
    if (closed && leaf && leaf.view.getViewType() === 'empty') {
      const { grid } = closed.trip;
      closed = null;
      void leaf.setViewState({ type: GRID_VIEW_TYPE, state: grid, active: true });
    }
  };

  const draw = (leaf: WorkspaceLeaf, trip: Trip): void => {
    const box = leaf.view.containerEl;
    let nav = box.querySelector<HTMLElement>(':scope > .buba-pager');
    const file = fileOf(leaf);
    const index = file ? trip.files.indexOf(file.path) : -1;
    if (index < 0) {
      nav?.remove();
      return;
    }
    if (!nav) nav = make(box, leaf);
    const [prev, next] = Array.from(nav.children) as HTMLElement[];
    const count = trip.files.length;
    prev?.toggle(neighbor(index, count, -1) !== index);
    next?.toggle(neighbor(index, count, 1) !== index);
  };

  /** The arrows of a file view; a tap on the file toggles them. */
  const make = (box: HTMLElement, leaf: WorkspaceLeaf): HTMLElement => {
    const nav = box.createDiv({ cls: 'buba-pager' });
    for (const [cls, icon, label, dir] of [
      ['mod-prev', 'lucide-chevron-left', t('previousFile'), -1],
      ['mod-next', 'lucide-chevron-right', t('nextFile'), 1],
    ] as const) {
      const button = nav.createDiv({
        cls: `clickable-icon buba-pager-nav ${cls}`,
        attr: { role: 'button', 'aria-label': label },
      });
      setIcon(button, icon);
      button.addEventListener('click', (evt) => {
        evt.stopPropagation();
        void step(leaf, dir);
      });
    }
    // On the view's own element: the listener goes with the view.
    box.addEventListener('click', (evt) => {
      if (!nav.isConnected || (evt.target as Element | null)?.closest?.(OWN_TAP)) return;
      nav.toggleClass('is-hidden', !nav.hasClass('is-hidden'));
    });
    return nav;
  };

  const step = async (leaf: WorkspaceLeaf, dir: -1 | 1): Promise<void> => {
    const trip = trips.get(leaf);
    const current = fileOf(leaf);
    if (!trip || !current) return;
    const index = trip.files.indexOf(current.path);
    const to = index < 0 ? index : neighbor(index, trip.files.length, dir);
    const file = to === index ? null : vault.getFileByPath(trip.files[to] ?? '');
    if (file) await leaf.openFile(file);
  };

  plugin.registerEvent(workspace.on('layout-change', sync));
  plugin.registerEvent(workspace.on('active-leaf-change', sync));
  plugin.registerEvent(workspace.on('file-open', sync));
  plugin.register(() => {
    for (const leaf of trips.keys()) leaf.view.containerEl.querySelector(':scope > .buba-pager')?.remove();
    trips.clear();
  });

  return async (view, file) => {
    const leaf = workspace.getLeaf(false);
    const trip: Trip | null = Platform.isPhone
      ? {
          grid: view.getState(),
          files: view.pathsInOrder().filter((path) => {
            const each = vault.getFileByPath(path);
            return each !== null && hasView(each.extension.toLowerCase());
          }),
        }
      : null;
    await leaf.openFile(file);
    if (!trip) return;
    trips.set(leaf, trip);
    sync();
  };
}
