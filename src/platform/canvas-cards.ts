// File cards on a canvas, computed over the canvas text (JSON Canvas 1.0, https://jsoncanvas.org/spec/1.0/)
// without importing `obsidian`: where cards go, which id to use, what to keep. Writing the canvas file is
// canvas-write.ts.

/** Card side and row step, as when dropping files from Obsidian's file tree (measured in Obsidian 1.13.7). */
export const CARD_SIZE = 400;
export const CARD_STEP = 445;

/**
 * Why cards were not added: `not-json` means the canvas text is not a JSON Canvas object, `nodes` means
 * `nodes` is not an array, `no-id` means no free id was found, `not-found` means the canvas is not in the
 * vault (`path`). `message` is English, for the journal and agent answers; the notice names the reason by
 * code from the dictionary (src/canvas/drop.ts).
 */
export class CanvasError extends Error {
  readonly code: 'not-json' | 'nodes' | 'no-id' | 'not-found';
  readonly path: string;

  constructor(code: CanvasError['code'], message: string, path = '') {
    super(message);
    this.name = 'CanvasError';
    this.code = code;
    this.path = path;
  }
}

export interface CanvasPoint {
  x: number;
  y: number;
}

/**
 * Visible canvas area from `WorkspaceLeaf.getViewState().state.viewState`: center in canvas coordinates,
 * scale `2^zoom`.
 */
export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

/** Screen rectangle of `view.contentEl`, from `getBoundingClientRect()`. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Canvas point under a screen point: the middle of `contentEl` is the visible center; rounded to integers.
 */
export function canvasPointFromClient(
  view: CanvasViewport,
  rect: ScreenRect,
  clientX: number,
  clientY: number,
): CanvasPoint {
  const scale = 2 ** view.zoom;
  return {
    x: whole(view.x + (clientX - rect.left - rect.width / 2) / scale),
    y: whole(view.y + (clientY - rect.top - rect.height / 2) / scale),
  };
}

/**
 * Fallback point when the visible area is unknown: right of all cards by the row gap (`CARD_STEP −
 * CARD_SIZE`), level with the top edge of the topmost one. An empty canvas gives (0, 0).
 */
export function pointRightOfContent(canvasText: string): CanvasPoint {
  const boxes = parseCanvas(canvasText).nodes.filter(isBox);
  if (boxes.length === 0) return { x: 0, y: 0 };
  return {
    x: Math.max(...boxes.map((box) => box.x + box.width)) + CARD_STEP - CARD_SIZE,
    y: Math.min(...boxes.map((box) => box.y)),
  };
}

/** Whether a file card for `path` is on the canvas; broken JSON throws, as in `addFileCards`. */
export function hasFileCard(canvasText: string, path: string): boolean {
  return parseCanvas(canvasText).nodes.some(
    (node) =>
      typeof node === 'object' &&
      node !== null &&
      (node as { type?: unknown }).type === 'file' &&
      (node as { file?: unknown }).file === path,
  );
}

/**
 * Canvas text with cards for `paths` in a row: the first with its top-left corner at `at`, the rest to the
 * right by `CARD_STEP`. Other cards, edges and unknown fields are kept; empty text is an empty canvas; broken
 * JSON throws, so the canvas is never overwritten. `newId` is the id source (16 random hex digits by
 * default); an id that collides with an existing one is drawn again.
 */
export function addFileCards(
  canvasText: string,
  paths: readonly string[],
  at: CanvasPoint,
  newId: () => string = randomId,
): string {
  const canvas = parseCanvas(canvasText);
  const edges: unknown[] = Array.isArray(canvas.edges) ? (canvas.edges as unknown[]) : [];
  const taken = new Set([...canvas.nodes, ...edges].map(idOf));
  paths.forEach((file, index) => {
    canvas.nodes.push({
      id: freshId(taken, newId),
      type: 'file',
      file,
      x: at.x + index * CARD_STEP,
      y: at.y,
      width: CARD_SIZE,
      height: CARD_SIZE,
    });
  });
  return JSON.stringify(canvas, null, '\t');
}

interface CanvasJson {
  nodes: unknown[];
  edges?: unknown;
  [key: string]: unknown;
}

function parseCanvas(text: string): CanvasJson {
  if (text.trim() === '') return { nodes: [], edges: [] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new CanvasError('not-json', 'Canvas text is not a JSON Canvas object');
  }
  const canvas = data as Record<string, unknown>;
  canvas.nodes ??= [];
  if (!Array.isArray(canvas.nodes)) throw new CanvasError('nodes', 'Canvas nodes is not an array');
  return canvas as CanvasJson;
}

function isBox(node: unknown): node is { x: number; y: number; width: number } {
  if (typeof node !== 'object' || node === null) return false;
  const { x, y, width } = node as Record<string, unknown>;
  return [x, y, width].every(Number.isFinite);
}

function idOf(item: unknown): unknown {
  return typeof item === 'object' && item !== null ? (item as Record<string, unknown>).id : undefined;
}

function freshId(taken: Set<unknown>, newId: () => string): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = newId();
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
  throw new CanvasError('no-id', 'No free card id: 100 collisions in a row with existing ones');
}

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

// Math.round(−0.4) gives −0; adding zero turns it into 0 and leaves NaN as NaN.
function whole(value: number): number {
  return Math.round(value) + 0;
}
