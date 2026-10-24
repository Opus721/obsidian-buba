// A series of mouse clicks on grid bodies: the second and later clicks of a series belong to the place of its
// first press, not to whatever is under the pointer now. The browser counts clicks in a series (`detail`, UI
// Events): the second press, release, click and the `dblclick` all have 2, and the pointer stays put between
// clicks, or it is not a double click. The grid sometimes re-lays out between clicks (the first click
// selected a tile and slid the file panel out, the column count changed), and now another tile, a folder
// tile, empty space or the panel itself is under the pointer. `onGridEvent` subscriptions (selection.ts)
// write and read the record, and the grid view (view.ts) uses `seriesTile` for its own `dblclick` on the
// body. No `obsidian` and no styles: the view loads this without the selection module.

/**
 * Movement from the press point after which it is a drag, not a click, px: a marquee on empty space, the
 * scrollbar.
 */
export const DRAG_PX = 4;

/** Mouse click events whose second and later clicks in a series belong to the place of the first press. */
export const SERIES: ReadonlySet<string> = new Set(['mousedown', 'mouseup', 'click', 'dblclick']);

/**
 * Press place: the grid body and the path of the tile under the pointer at that moment; `null` for empty
 * space.
 */
export interface Press {
  readonly body: HTMLElement;
  readonly path: string | null;
}

/**
 * First press of the current click series in a document: `null` if it began outside grids, `undefined` if
 * unseen.
 */
interface Series {
  first: Press | null | undefined;
  users: number;
  readonly stop: () => void;
}

/** One series record per Obsidian window document, however many subscriptions hold it. */
const series = new WeakMap<Document, Series>();

/** Where the press was: the grid body under the pointer and the tile path; `null` outside grid bodies. */
export function pressAt(target: EventTarget | null): Press | null {
  const el = target as Element | null;
  if (typeof el?.closest !== 'function') return null;
  const body = el.closest<HTMLElement>('.buba-grid-scroller');
  if (!body) return null;
  const tile = el.closest<HTMLElement>('.buba-tile[data-path]');
  return { body, path: (tile && body.contains(tile) && tile.dataset.path) || null };
}

/**
 * The tile a repeated click of a series in `body` belongs to: the tile of the series' first press, as for
 * `onGridEvent` subscriptions. A path; `null` if the series began on empty space, in another body or outside
 * grids; `undefined` if this is the first click, a phone tap, or the record missed the series' press, so the
 * place is under the pointer.
 */
export function seriesTile(body: HTMLElement, evt: MouseEvent): string | null | undefined {
  const first = firstOfSeries(body.doc, evt);
  if (first === undefined) return undefined;
  return first?.body === body ? first.path : null;
}

/**
 * Second and later clicks of a series have `detail` 2 or more; the phone module's tap `dblclick` has no
 * count.
 */
function isRepeat(evt: Event): boolean {
  return ((evt as Partial<MouseEvent>).detail ?? 0) >= 2;
}

/**
 * Place of the first press of the series a repeated click belongs to; `undefined` if the click is the first
 * in its series or the record missed this series' press.
 */
export function firstOfSeries(doc: Document, evt: Event): Press | null | undefined {
  return isRepeat(evt) ? series.get(doc)?.first : undefined;
}

/**
 * Records the first press of every click series in the document, with one listener per document; the last
 * subscription releases it. The tile path is taken at press time: the grid draws only visible tiles and
 * reuses an element for another path after a re-layout. The listener is on capture, so the record is ready
 * before the grid body listeners and bubbling.
 */
export function watchSeries(doc: Document): () => void {
  const entry = series.get(doc) ?? startSeries(doc);
  entry.users += 1;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    entry.users -= 1;
    if (entry.users > 0) return;
    entry.stop();
    series.delete(doc);
  };
}

function startSeries(doc: Document): Series {
  const record = (evt: MouseEvent): void => {
    if (!isRepeat(evt)) {
      entry.first = pressAt(evt.target);
      return;
    }
    const { first } = entry;
    if (first?.path && evt.button === 0 && evt.target === first.body && onScrollbar(first.body, evt))
      clickPastScrollbar(doc, first.body, evt);
  };
  const entry: Series = {
    first: undefined,
    users: 0,
    stop: () => doc.removeEventListener('mousedown', record, true),
  };
  doc.addEventListener('mousedown', record, true);
  series.set(doc, entry);
  return entry;
}

/**
 * The second press of a double click landed on the body's scrollbar, which moved under the pointer with the
 * grid. Chromium does not count a click on a scrollbar: the release comes with `detail` 0 and there is no
 * `click` or `dblclick` (Obsidian 1.13). Such a release at the press point sends the body a `dblclick` with
 * detail 2, as the phone module does for tiles, so subscriptions get the place of the first press. The
 * listener lives until this press is released.
 */
function clickPastScrollbar(doc: Document, body: HTMLElement, down: MouseEvent): void {
  const up = (evt: MouseEvent): void => {
    if (evt.button !== 0) return;
    doc.removeEventListener('mouseup', up);
    const still = Math.hypot(evt.clientX - down.clientX, evt.clientY - down.clientY) < DRAG_PX;
    if (evt.detail !== 0 || !still) return;
    const { clientX, clientY, screenX, screenY, ctrlKey, metaKey, shiftKey, altKey } = evt;
    const init = { clientX, clientY, screenX, screenY, ctrlKey, metaKey, shiftKey, altKey };
    body.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2, button: 0, ...init }),
    );
  };
  doc.addEventListener('mouseup', up);
}

/** A press on the body's scrollbar is neither a click nor a marquee. */
export function onScrollbar(body: HTMLElement, evt: MouseEvent): boolean {
  const box = body.getBoundingClientRect();
  return (
    evt.clientX >= box.left + body.clientLeft + body.clientWidth ||
    evt.clientY >= box.top + body.clientTop + body.clientHeight
  );
}
