// Grid keys for tags and rating: T opens the tags window, 1–5 set the rating. T is matched by its physical
// position (`KeyboardEvent.code`, https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code), not
// by letter: in a Russian layout T types a Cyrillic letter while `code` stays `KeyT`. Rating uses the digit
// character (`KeyboardEvent.key`), like Obsidian hotkeys: with NumLock off the numpad keys navigate (`code`
// stays `Numpad1` while `key` is `End`, `ArrowDown`, `PageDown`…) and must not set a rating. No `obsidian`
// import, checked by `node --test`.
import type { Rating } from '../storage/types.ts';

export type KeyAction = { kind: 'tag' } | { kind: 'rate'; rating: Exclude<Rating, 0> };

const RATING_CHAR = /^[1-5]$/;

/** Event modifiers; a real `KeyboardEvent` fits as is. */
export interface KeyModifiers {
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
}

/**
 * Action of a key by `KeyboardEvent.code` and `KeyboardEvent.key`; `null` if the key is not ours. With a
 * modifier held it is also `null`: the combination (Ctrl+T is a new tab) stays with Obsidian.
 */
export function keyAction(code: string, key: string, mods: KeyModifiers = {}): KeyAction | null {
  if (mods.ctrlKey || mods.metaKey || mods.altKey || mods.shiftKey) return null;
  if (code === 'KeyT') return { kind: 'tag' };
  return RATING_CHAR.test(key) ? { kind: 'rate', rating: Number(key) as Exclude<Rating, 0> } : null;
}

/** What we need to know about the focused element; a real `Element` fits as is. */
export interface TypingTarget {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
}

/** An input, `textarea`, `select` or `contenteditable`: keys type there instead of acting. */
export function isTypingTarget(el: TypingTarget | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}
