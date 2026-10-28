// Files from the file manager dropped on the grid body, and files pasted with Ctrl+V while the grid body has
// focus, are written through `importFiles`: into the open folder; for "All files", where Obsidian puts
// attachments; for another module's source, into the folder open before it, followed by that source's "accept
// added" step. Buba tiles dropped on the grid are not an import (`hasBubaDragData`). The grid draws new tiles
// itself: the file index follows vault events. Added files become the grid's selection and the first is
// scrolled into view (`buba:added-select`, the selection module), so a new file does not get lost in the sort.
// The added files are one undo step: Ctrl+Z puts them into the trash.
import { Notice, type App, type Plugin } from 'obsidian';
import { t } from '../../core/i18n/dict/actions.ts';
import { ADDED_SELECT } from '../../core/layout/grid-events.ts';
import { normalizeGridViewState } from '../../core/layout/view-state.ts';
import { hasBubaDragData } from '../../platform/canvas-drag.ts';
import {
  VAULT_ATTACHMENTS,
  importFiles,
  readDropped,
  readPasted,
  type EventFiles,
  type ImportFolder,
} from '../../platform/files/import.ts';
import { recordCreated } from '../../platform/files/undo.ts';
import type { AddedTag, BubaAssets } from '../api.ts';
import { onGridEvent, type GridLeafView } from '../grid/selection.ts';

/** Class of the grid body while files from disk are dragged over it, as on an Obsidian tree folder. */
const OVER = 'is-being-dragged-over';
/** The same moment on the whole view, which draws the overlay (grid.css). */
const VIEW_OVER = 'buba-drop-over';
/** A notice with refusals stays longer so the names can be read, ms. */
const REFUSED_MS = 10_000;

export function registerImportDrop(plugin: Plugin, assets: BubaAssets): void {
  onGridEvent(plugin, assets, 'dragover', (evt, { view, body }) => {
    const dt = evt.dataTransfer;
    if (!fromDisk(dt)) return;
    evt.preventDefault();
    dt.dropEffect = 'copy';
    over(view, body, true);
  });
  onGridEvent(plugin, assets, 'dragleave', (evt, { view, body }) => {
    const to = evt.relatedTarget as Node | null;
    if (!to || !body.contains(to)) over(view, body, false);
  });
  onGridEvent(plugin, assets, 'drop', (evt, { view, body }) => {
    over(view, body, false);
    const dt = evt.dataTransfer;
    if (!fromDisk(dt)) return;
    evt.preventDefault();
    void put(view, assets, readDropped(dt));
  });
  onGridEvent(plugin, assets, 'paste', (evt, { view }) => {
    if (!evt.clipboardData) return;
    const files = readPasted(evt.clipboardData);
    if (!files.items.length && !files.refused.length) return;
    evt.preventDefault();
    void put(view, assets, files);
  });
}

function over(view: GridLeafView, body: HTMLElement, on: boolean): void {
  if (on) {
    body.addClass(OVER);
    view.contentEl.addClass(VIEW_OVER);
  } else {
    body.removeClass(OVER);
    view.contentEl.removeClass(VIEW_OVER);
  }
}

/** Files from disk are being dragged, not Buba tiles: `dragover` cannot read the data, only `types`. */
function fromDisk(dt: DataTransfer | null): dt is DataTransfer {
  return dt !== null && dt.types.includes('Files') && !hasBubaDragData(dt);
}

/** The source's "accept added" step: written paths → what was done (data for the notice) or `null`. */
export type AcceptAdded = (paths: readonly string[]) => Promise<AddedTag | null>;

/** Where the grid puts added files and what happens after the write. */
export interface GridTarget {
  folder: ImportFolder;
  /** The step of another module's open source, if it declares one (`acceptAdded`). */
  accept?: AcceptAdded;
  /** The grid the files are added through: it selects them; without it, every grid that shows them. */
  view?: GridLeafView;
}

/**
 * Where to put files: an open folder (`folder`, root is `'/'`) gets them; "All files"
 * (`null`) sends them where Obsidian puts attachments. Another module's source (the `source`
 * of a registered view: a tag, "Untagged", a group) uses the folder open before it (kept in
 * the grid state, `nextGridState`); if there is none or it was deleted, the attachments
 * folder for no open file; after the write, its "accept added" step runs. A source whose
 * view is not in the registry is shown by the grid as a folder, and treated the same here.
 */
export function gridTarget(view: GridLeafView, assets: BubaAssets): GridTarget {
  const { folder, source } = normalizeGridViewState(view.getState());
  const provider = source && assets.gridSource(source.kind);
  if (!source || !provider) return { folder, view };
  const kept = folder === '/' || (folder !== null && view.app.vault.getFolderByPath(folder) !== null);
  const step = provider.acceptAdded;
  return {
    folder: kept ? folder : VAULT_ATTACHMENTS,
    view,
    ...(step && { accept: (paths: readonly string[]) => step.call(provider, source, paths) }),
  };
}

async function put(view: GridLeafView, assets: BubaAssets, files: EventFiles): Promise<void> {
  const { folder, accept } = gridTarget(view, assets);
  await importInto(view.app, folder, files, { accept, view });
}

/**
 * Writes the event's files into a folder (`folder` is a path from the vault root, root is
 * `'/'`; `null` and `VAULT_ATTACHMENTS` mean Obsidian's attachments folder) and reports the
 * result in a notice. Shared by the grid, the tree and the file picker. With `progress`, an
 * "Adding k of n…" notice stays while writing (the picker: a batch of videos takes a while);
 * drop and paste do not ask for it. `accept` is the open source's step: called once after the
 * whole batch is written, with the paths written completely; its phrase joins the notice. Then the written
 * files are selected in `view`, the grid they were added through, or in every grid that shows them.
 */
export async function importInto(
  app: App,
  folder: ImportFolder,
  files: EventFiles,
  options: { progress?: boolean; accept?: AcceptAdded; view?: GridLeafView } = {},
): Promise<void> {
  // Progress handler for the write; the type is declared, otherwise TypeScript sees only `null` here.
  let going = null as Notice | null;
  let created: readonly string[] = [];
  const onItem = options.progress
    ? (index: number, total: number) => {
        const text = t('adding', { index, total });
        if (going) going.setMessage(text);
        else going = new Notice(text, 0);
      }
    : undefined;
  try {
    const result = await importFiles(app, folder, files.items, new Date(), onItem);
    going?.hide();
    const refused = [...files.refused, ...result.refused];
    const [first] = result.created;
    const head =
      first === undefined
        ? t('nothingAdded')
        : addedHead(
            { count: result.created.length, folder: folderOf(first) ?? app.vault.getName() },
            await accepted(options.accept, result.created),
          );
    // Names from the file manager, clipboard and picker are external input: text only, never HTML.
    const message = createFragment((el) => {
      el.createDiv({ text: head });
      for (const { name, reason } of refused) el.createDiv({ text: t('namedReason', { name, reason }) });
    });
    new Notice(message, refused.length ? REFUSED_MS : undefined);
    created = result.created;
    // After the source step, so the added files are the last step even when the step tagged them.
    if (first !== undefined) recordCreated(app, 'import', folderOf(first) ?? app.vault.getName(), created);
  } catch (error) {
    going?.hide();
    new Notice(t('notAdded', { error: error instanceof Error ? error.message : String(error) }));
  }
  if (created.length) app.workspace.trigger(ADDED_SELECT, options.view ?? null, created);
}

/** Result of the source step: what it did, or its exception text; `null` without a step or nothing to say. */
type Accepted = AddedTag | { refused: string } | null;

/** The source step over written paths; its failure becomes a notice line, the files are already written. */
async function accepted(accept: AcceptAdded | undefined, paths: readonly string[]): Promise<Accepted> {
  if (!accept) return null;
  try {
    return await accept(paths);
  } catch (error) {
    console.error('Buba: grid source did not accept added files', error);
    return { refused: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * First notice line as one dictionary phrase: how many files were added where, and what the source step did.
 */
function addedHead(vars: { count: number; folder: string }, step: Accepted): string {
  if (step === null) return t('added', vars);
  if ('refused' in step) return t('addedSourceRefused', { ...vars, error: step.refused });
  if (step.error !== undefined) return t('addedNotTagged', { ...vars, tag: step.tag, reason: step.error });
  return t('addedTagged', { ...vars, tag: step.tag });
}

/** Folder of a file by its path from the vault root; `null` for a file in the root. */
function folderOf(path: string): string | null {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? null : path.slice(0, slash);
}
