// "On canvases" in the file panel: canvases holding the file as a card, a group background or a link in card
// text. Obsidian knows this: the built-in canvas (1.12+) indexes its links into
// `metadataCache.resolvedLinks[canvas][file]`, as notes do; Obsidian's "Backlinks" also lists canvases as
// sources. The panel keeps the canvas list itself: scanning every `resolvedLinks` source on each render costs
// about 20 ms per 50k notes, and on a phone the collapsed panel renders on every tap. No `obsidian` import.

/** Vault links like `metadataCache.resolvedLinks`: source → target → link count. */
export type ResolvedLinks = Readonly<Record<string, Readonly<Record<string, number>> | undefined>>;

/** Under `root`: the path itself or anything in the `root` folder. */
function under(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Canvases of the vault as `.canvas` file paths; deleting or moving a folder takes everything under it along.
 */
export class CanvasList implements Iterable<string> {
  readonly #paths = new Set<string>();

  /** Returns whether the list changed. */
  add(path: string): boolean {
    if (this.#paths.has(path)) return false;
    this.#paths.add(path);
    return true;
  }

  /** Canvas `path` or all canvases in folder `path`; returns whether the list changed. */
  delete(path: string): boolean {
    let changed = false;
    for (const held of [...this.#paths]) if (under(held, path)) changed = this.#paths.delete(held) || changed;
    return changed;
  }

  /** Moves a canvas or folder: paths under `from` get the prefix `to`; returns whether the list changed. */
  move(from: string, to: string): boolean {
    const moved = [...this.#paths].filter((held) => under(held, from));
    for (const held of moved) this.#paths.delete(held);
    for (const held of moved) this.#paths.add(to + held.slice(from.length));
    return moved.length > 0;
  }

  [Symbol.iterator](): Iterator<string> {
    return this.#paths.values();
  }
}

/** Canvas name without folder and `.canvas`, as in Obsidian's file explorer. */
export function boardName(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.endsWith('.canvas') ? name.slice(0, -'.canvas'.length) : name;
}

/** Canvas folder, like the row caption in Obsidian's "Outgoing links"; `''` for a canvas in the root. */
export function boardFolder(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** Whether file `path` is on canvas `canvas`: the canvas entry links to it. */
export function isOnBoard(path: string, canvas: string, links: ResolvedLinks): boolean {
  const targets = links[canvas];
  return targets !== undefined && Object.hasOwn(targets, path) && (targets[path] ?? 0) > 0;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Canvases from `canvases` that hold file `path`, sorted by name with numbers
 * in order ("Board 2" before "Board 10"), then by path for equal names. Reads
 * only the entries of these canvases, never scans `links` sources.
 */
export function boardsWith(path: string, canvases: Iterable<string>, links: ResolvedLinks): string[] {
  const found: string[] = [];
  for (const canvas of canvases) if (isOnBoard(path, canvas, links)) found.push(canvas);
  return found.sort((a, b) => collator.compare(boardName(a), boardName(b)) || collator.compare(a, b));
}
