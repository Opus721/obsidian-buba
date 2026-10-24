// Reference tags inside a prompt: `@Image1`, `Video2`, `Audio1` (with or without `@`) and the agent's own
// tokens. The text is cut into plain pieces and tags that match a reference of the passport; a tag without
// its reference stays plain text. Display only: nothing here is parsed as markup. No `obsidian` import.
import type { RefSlot } from './refs.ts';

export type PromptPiece = { text: string; slot?: RefSlot };

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Letters, digits and `_` of any script: a tag is not part of a longer word. The character before a tag is
 * matched, not looked behind: iOS before 16.4 has no lookbehind.
 */
const BEFORE = '(^|[^\\p{L}\\p{N}_])';
const AFTER = '(?![\\p{L}\\p{N}_])';

/** Prompt cut into pieces; adjacent plain text is one piece. */
export function promptPieces(text: string, slots: readonly RefSlot[]): PromptPiece[] {
  const byTag = new Map<string, RefSlot>();
  for (const slot of slots) if (slot.tag && !byTag.has(slot.tag)) byTag.set(slot.tag, slot);
  const byToken = new Map<string, RefSlot>();
  for (const slot of slots) {
    const token = slot.ref.token?.replace(/^@/, '');
    if (token && !byToken.has(token)) byToken.set(token, slot);
  }
  // Longer tokens first, so `hero2` is not taken as `hero` followed by text.
  const tokens = [...byToken.keys()].sort((a, b) => b.length - a.length).map(escape);
  const names = ['(?:Image|Video|Audio)\\d+', ...tokens].join('|');
  const pattern = new RegExp(`${BEFORE}(@?)(${names})${AFTER}`, 'gu');
  const pieces: PromptPiece[] = [];
  const plain = (piece: string): void => {
    if (!piece) return;
    const last = pieces[pieces.length - 1];
    if (last && !last.slot) last.text += piece;
    else pieces.push({ text: piece });
  };
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const [whole, before = '', mark = '', name = ''] = match;
    const slot = byToken.get(name) ?? byTag.get(name);
    if (!slot) continue;
    const start = match.index + before.length;
    plain(text.slice(at, start));
    pieces.push({ text: mark + name, slot });
    at = match.index + whole.length;
  }
  plain(text.slice(at));
  return pieces;
}
