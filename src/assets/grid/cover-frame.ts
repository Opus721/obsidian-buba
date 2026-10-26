// "Move cover" on a folder tile (cover-menu.ts → GridView.frameCover → Tiles.frameCover): while it is on,
// dragging the tile moves the cover, the wheel or two fingers zoom it; Enter or a press outside the tile keeps
// the frame, Esc puts the old one back. The tile's own presses (selection, opening, drag out, its menu) are
// held back meanwhile. Geometry is in src/core/layout/cover-frame.ts; the tile draws the frame itself.
import { panFrame, zoomFrame } from '../../core/layout/cover-frame.ts';
import type { CoverFrame } from '../../core/storage/types.ts';

export interface FramingHooks {
  /** The box the cover fills now, the back plate or the front; `null` when the tile no longer shows it. */
  box(): HTMLElement | null;
  /** Background size of `frame` in that box, percent of it. */
  size(frame: CoverFrame): { w: number; h: number };
  /** Draws `frame` on the tile. */
  apply(frame: CoverFrame): void;
  /** Framing ended: the frame to keep, or `null` when it was cancelled. */
  done(frame: CoverFrame | null): void;
}

/** Wheel zoom per pixel of `deltaY`: one mouse notch (about 100 px) zooms about 20 %. */
const WHEEL_ZOOM = 0.0018;
/** Presses of the tile held back while framing. */
const HELD = ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'dragstart'] as const;

/** Starts framing on tile `el` from `start`; returns a stop that cancels it. */
export function startFraming(el: HTMLElement, start: CoverFrame, hooks: FramingHooks): () => void {
  const doc = el.doc;
  let frame = start;
  let ended = false;
  const pointers = new Map<number, { x: number; y: number }>();

  const set = (next: CoverFrame): void => {
    frame = next;
    hooks.apply(frame);
  };
  const spread = (): number => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const down = (evt: PointerEvent): void => {
    evt.preventDefault();
    evt.stopPropagation();
    if (evt.pointerType === 'mouse' && evt.button !== 0) return;
    pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
    el.setPointerCapture(evt.pointerId);
    el.addClass('is-moving-cover');
  };
  const move = (evt: PointerEvent): void => {
    const last = pointers.get(evt.pointerId);
    if (!last) return;
    evt.preventDefault();
    evt.stopPropagation();
    const before = spread();
    pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
    if (pointers.size >= 2) {
      const after = spread();
      if (before > 0 && after > 0) set(zoomFrame(frame, after / before));
      return;
    }
    const box = hooks.box();
    if (!box) return finish(true);
    const { width, height } = box.getBoundingClientRect();
    set(panFrame(frame, evt.clientX - last.x, evt.clientY - last.y, width, height, hooks.size(frame)));
  };
  const up = (evt: PointerEvent): void => {
    if (!pointers.delete(evt.pointerId)) return;
    evt.stopPropagation();
    if (pointers.size === 0) el.removeClass('is-moving-cover');
  };
  const wheel = (evt: WheelEvent): void => {
    evt.preventDefault();
    evt.stopPropagation();
    set(zoomFrame(frame, Math.exp(-evt.deltaY * WHEEL_ZOOM)));
  };
  const hold = (evt: Event): void => {
    evt.preventDefault();
    evt.stopPropagation();
  };
  const key = (evt: KeyboardEvent): void => {
    if (evt.key !== 'Enter' && evt.key !== 'Escape') return;
    evt.preventDefault();
    evt.stopPropagation();
    finish(evt.key === 'Enter');
  };
  // A press anywhere else keeps the frame and goes on as usual.
  const outside = (evt: PointerEvent): void => {
    if (!el.contains(evt.target as Node | null)) finish(true);
  };

  const finish = (keep: boolean): void => {
    if (ended) return;
    ended = true;
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('wheel', wheel);
    for (const type of HELD) el.removeEventListener(type, hold);
    doc.removeEventListener('keydown', key, true);
    doc.removeEventListener('pointerdown', outside, true);
    el.removeClasses(['is-framing', 'is-moving-cover']);
    hooks.done(keep ? frame : null);
  };

  el.addClass('is-framing');
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  for (const type of HELD) el.addEventListener(type, hold);
  doc.addEventListener('keydown', key, true);
  doc.addEventListener('pointerdown', outside, true);
  hooks.apply(frame);
  return () => finish(false);
}
