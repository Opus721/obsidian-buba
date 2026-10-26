// Expand and collapse motion of the Buba trees (folders and tag groups): the children block grows from zero
// to its height or shrinks to zero, with a fade, like the file trees the owner picked as references. Only
// on a computer: on a phone a tap expands at once, as in Obsidian. The system "reduce motion" setting turns
// it off. Obsidian's own file explorer has no motion, so this is ours. The block is
// measured after it is drawn, and the duration grows a little with height, within 150–260 ms.
import { Platform } from 'obsidian';

/** Easing of the halaska-studio file tree from the references: a fast start and a long soft stop. */
const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';

function moving(el: HTMLElement): boolean {
  if (Platform.isMobile || typeof el.animate !== 'function') return false;
  return !el.win.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The children block `el` has just been drawn under an expanded row: it grows from zero height. */
export function expandMotion(el: HTMLElement): void {
  if (!moving(el)) return;
  const height = el.scrollHeight;
  if (height === 0) return;
  el.animate(
    [
      { height: '0px', opacity: 0, overflow: 'hidden' },
      { height: `${height}px`, opacity: 1, overflow: 'hidden' },
    ],
    { duration: Math.min(180 + height * 0.08, 260), easing: EASE },
  );
}

/**
 * The children block `el` shrinks to zero, then `done` collapses the row for real. Without motion `done`
 * runs at once. `done` comes from a timer, not the animation's end: a re-render that removes the block
 * would otherwise leave the row expanded.
 */
export function collapseMotion(el: HTMLElement, done: () => void): void {
  const height = el.scrollHeight;
  if (!moving(el) || height === 0) {
    done();
    return;
  }
  const duration = Math.min(150 + height * 0.06, 220);
  el.animate(
    [
      { height: `${height}px`, opacity: 1, overflow: 'hidden' },
      { height: '0px', opacity: 0, overflow: 'hidden' },
    ],
    { duration, easing: EASE, fill: 'forwards' },
  );
  el.win.setTimeout(done, duration);
}
