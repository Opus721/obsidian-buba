// Files picked on an open canvas, without importing `obsidian` and without the canvas internals:
// the canvas marks a picked card `is-focused` (one) or `is-selected` (several, measured in Obsidian 1.14.4),
// and places every card by `transform: translate(Xpx, Ypx)`, `width` and `height` in canvas coordinates,
// the same numbers as the card's `x`, `y`, `width` and `height` in the canvas text (JSON Canvas 1.0,
// https://jsoncanvas.org/spec/1.0/). A file card of the text with the same box is the picked file.

/** A card's box in canvas coordinates. */
export interface CardBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Picked cards on the canvas page. */
export const PICKED_CARDS = '.canvas-node.is-focused, .canvas-node.is-selected';

const TRANSLATE = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/;

/** Box of a card from its inline style; `null` if the style does not place it. */
export function cardBox(style: { transform: string; width: string; height: string }): CardBox | null {
  const at = TRANSLATE.exec(style.transform);
  const width = Number.parseFloat(style.width);
  const height = Number.parseFloat(style.height);
  if (!at || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { x: Number(at[1]), y: Number(at[2]), width, height };
}

/** File cards of the canvas text: path and box; an unreadable text gives none. */
export function fileCards(text: string): { file: string; box: CardBox }[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const nodes = (data as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return [];
  const cards: { file: string; box: CardBox }[] = [];
  for (const node of nodes as Record<string, unknown>[]) {
    const { type, file, x, y, width, height } = node ?? {};
    if (type !== 'file' || typeof file !== 'string') continue;
    if ([x, y, width, height].some((value) => typeof value !== 'number')) continue;
    cards.push({ file, box: { x, y, width, height } as CardBox });
  }
  return cards;
}

/** Files of the picked boxes, in the order of the boxes, each once; a box of a text or group card is skipped. */
export function pickedFiles(text: string, picked: readonly CardBox[]): string[] {
  const cards = fileCards(text);
  const files = new Set<string>();
  for (const box of picked) {
    const card = cards.find(
      ({ box: at }) => at.x === box.x && at.y === box.y && at.width === box.width && at.height === box.height,
    );
    if (card) files.add(card.file);
  }
  return [...files];
}

/** Picked files of the canvas page `el` whose text is `text`. */
export function canvasPicked(el: HTMLElement, text: string): string[] {
  const boxes = [...el.querySelectorAll<HTMLElement>(PICKED_CARDS)]
    .map((card) => cardBox(card.style))
    .filter((box) => box !== null);
  return boxes.length ? pickedFiles(text, boxes) : [];
}
