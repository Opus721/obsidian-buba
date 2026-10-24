// Tile size step: the slider above the grid, Ctrl + wheel over it, and the "Increase tile size" and "Decrease
// tile size" commands all use one step of 10 px within 80-400. The wheel works like Obsidian 1.14.4: the
// image view (`handleWheelZoom`) takes `ctrlKey || metaKey` and scales by `deltaMode` (line x40, page x800);
// "Quick font size adjustment" ignores events in the first 500 ms after a scroll without a modifier. The
// wheel modifier is defined here in one place: there is no setting for it, the default is Ctrl.
import { TILE_SIZE_MAX, TILE_SIZE_MIN } from './view-state.ts';

/** Step of the tile size slider, also the step of the wheel and the commands. */
export const TILE_SIZE_STEP = 10;
/** Wheel pixels per size step: a wheel notch is 100 or more, a trackpad pinch comes in small amounts. */
export const WHEEL_STEP_PX = 50;
/** How long after a plain scroll a modified wheel still counts as scrolling, ms (as in Obsidian). */
export const PLAIN_WHEEL_PAUSE_MS = 500;

/** What the wheel changes the tile size with: Ctrl (also Cmd on macOS), Alt, or nothing. */
export type WheelModifier = 'ctrl' | 'alt' | 'off';
export const WHEEL_MODIFIER_DEFAULT: WheelModifier = 'ctrl';

/** What the wheel takes from the browser event. */
export interface WheelInput {
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly timeStamp: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * Size `steps` steps from `size`: off the slider grid it goes to the nearest step in the step's
 * direction, within 80-400.
 */
export function stepTileSize(size: number, steps: number): number {
  const at = (size - TILE_SIZE_MIN) / TILE_SIZE_STEP;
  const base = steps > 0 ? Math.floor(at) : steps < 0 ? Math.ceil(at) : Math.round(at);
  return Math.min(TILE_SIZE_MAX, Math.max(TILE_SIZE_MIN, TILE_SIZE_MIN + (base + steps) * TILE_SIZE_STEP));
}

/** Scroll pixels by `deltaMode`: 0 pixels, 1 lines (x40), 2 pages (x800), as in Obsidian. */
export function wheelPixels(deltaY: number, deltaMode: number): number {
  return deltaY * (deltaMode === 1 ? 40 : deltaMode === 2 ? 800 : 1);
}

/**
 * Wheel steps: a notch of at least `WHEEL_STEP_PX` is exactly one step and resets the carry; small deltas
 * (trackpad pinch) add up to `WHEEL_STEP_PX` and the rest carries over. Away from you (delta below zero)
 * makes tiles larger, towards you smaller.
 */
export function wheelSteps(
  carry: number,
  deltaY: number,
  deltaMode: number,
): { steps: number; carry: number } {
  const delta = wheelPixels(deltaY, deltaMode);
  if (Math.abs(delta) >= WHEEL_STEP_PX) return { steps: -Math.sign(delta), carry: 0 };
  let rest = carry + delta;
  let steps = 0;
  while (Math.abs(rest) >= WHEEL_STEP_PX) {
    steps -= Math.sign(rest);
    rest -= Math.sign(rest) * WHEEL_STEP_PX;
  }
  return { steps, carry: rest };
}

/**
 * Whether the wheel modifier is held and only it: Ctrl means `ctrlKey` or `metaKey` (Cmd) without Alt and
 * Shift; Alt means Alt alone.
 */
export function wheelModifierHeld(
  evt: Pick<WheelInput, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  modifier: WheelModifier = WHEEL_MODIFIER_DEFAULT,
): boolean {
  if (evt.shiftKey) return false;
  if (modifier === 'ctrl') return (evt.ctrlKey || evt.metaKey) && !evt.altKey;
  if (modifier === 'alt') return evt.altKey && !evt.ctrlKey && !evt.metaKey;
  return false;
}

/**
 * The wheel of one grid view: keeps the carry and the time of the last scroll without a modifier. `null`
 * means the event is not ours (scrolling, another combination, the first 500 ms after a scroll) and is not
 * cancelled; a number means it is ours and is cancelled, even with 0 steps.
 */
export class TileWheel {
  #carry = 0;
  #plainAt = Number.NEGATIVE_INFINITY;

  take(evt: WheelInput, modifier: WheelModifier = WHEEL_MODIFIER_DEFAULT): number | null {
    if (!wheelModifierHeld(evt, modifier)) {
      if (!evt.ctrlKey && !evt.metaKey && !evt.altKey && !evt.shiftKey) {
        this.#plainAt = evt.timeStamp;
        this.#carry = 0;
      }
      return null;
    }
    if (evt.timeStamp - this.#plainAt < PLAIN_WHEEL_PAUSE_MS) return null;
    const next = wheelSteps(this.#carry, evt.deltaY, evt.deltaMode);
    this.#carry = next.carry;
    return next.steps;
  }
}
