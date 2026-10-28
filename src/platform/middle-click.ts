// The middle mouse button opens in a new tab, as in Obsidian's file explorer, search and links (word of the
// owner 28.10 17:02). The press is cancelled, as on Obsidian's search rows: otherwise Windows starts
// middle-button autoscroll and no `auxclick` follows (src/generation/thumbs.ts).

/**
 * On `el`, a middle-button click on what `hit` finds (`null` — not ours, the event goes on untouched) calls
 * `open` with it. `el` may be a container: `hit` reads the event's target.
 */
export function onMiddleClick<T>(
  el: HTMLElement | Document,
  hit: (evt: MouseEvent) => T | null,
  open: (found: T, evt: MouseEvent) => void,
): () => void {
  const down = (evt: MouseEvent): void => {
    if (evt.button === 1 && hit(evt) !== null) evt.preventDefault();
  };
  const aux = (evt: MouseEvent): void => {
    if (evt.button !== 1) return;
    const found = hit(evt);
    if (found === null) return;
    evt.preventDefault();
    evt.stopPropagation();
    open(found, evt);
  };
  el.addEventListener('mousedown', down as EventListener);
  el.addEventListener('auxclick', aux as EventListener);
  return () => {
    el.removeEventListener('mousedown', down as EventListener);
    el.removeEventListener('auxclick', aux as EventListener);
  };
}
