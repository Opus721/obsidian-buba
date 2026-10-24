// First lines of a note or text file for a tile: plain text only, without properties,
// markup, embeds and HTML. It reaches the tile through `textContent`, never as HTML.
// Obsidian's API has no such cleaning (`MarkdownRenderer` builds HTML); Notebook
// Navigator does the same: lines without markup, its own cleaning. No `obsidian` import.

/** At most this many lines on a tile. */
export const EXCERPT_LINES = 14;
/** At most this many characters on a tile. */
export const EXCERPT_CHARS = 600;

/**
 * Text of the file head: UTF-8 without exceptions, BOM removed, a tail cut in the middle of a character
 * dropped (the streaming decoder holds back the incomplete character). A NUL byte means not text: `null`.
 */
export function decodeHead(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  const text = new TextDecoder('utf-8').decode(bytes, { stream: true });
  return text.startsWith('﻿') ? text.slice(1) : text;
}

/**
 * First lines of a file from its head and extension; empty if it has none (empty, only properties, not text).
 */
export function excerptOf(bytes: Uint8Array, ext: string): string {
  const text = decodeHead(bytes);
  return text === null ? '' : excerptText(text, ext);
}

/** Note properties: `---` … `---` or `...` at the start; if unclosed, up to the end of what was read. */
const FRONT_MATTER =
  /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)??(?:---|\.\.\.)[ \t]*(?:\r?\n|$)|^---[ \t]*\r?\n[\s\S]*$/;

/** Removed whole, with their content: comments and HTML parts that run or draw. */
const DROPPED: readonly RegExp[] = [
  /%%[\s\S]*?(?:%%|$)/g,
  /<!--[\s\S]*?(?:-->|$)/g,
  /<(script|style|iframe)\b[\s\S]*?(?:<\/\1\s*>|$)/gi,
];

/** Line markup: what to replace with what, in order. */
const MARKUP: readonly (readonly [RegExp, string])[] = [
  // HTML tags without content; an unclosed tag at the end of what was read too. A tag does not span lines:
  // "a<b" and what follows is text, not a tag up to the next ">" further down.
  [/<\/?[a-zA-Z][^>\n]*(?:>|$)/g, ''],
  // Image and note embeds are not shown. Inside brackets: one line of at most 256 characters, otherwise 8 KB
  // of unclosed brackets makes the search quadratic.
  [/!\[\[[^\]\n]{0,256}\]\]/g, ''],
  [/!\[[^\]\n]{0,256}\]\([^)\n]{0,256}\)/g, ''],
  // Links become their text.
  [/\[\[[^\]|\n]{0,256}\|([^\]\n]{0,256})\]\]/g, '$1'],
  [/\[\[([^\]\n]{0,256})\]\]/g, '$1'],
  [/\[([^\]\n]{0,256})\]\([^)\n]{0,256}\)/g, '$1'],
  // Code fence lines are removed; the code itself stays.
  [/^[ \t]*(?:`{3,}|~{3,}).*$/gm, '\u0000'],
  // Quotes and callouts: the `>` marks and the callout header `[!note]`.
  [/^(?:[ \t]*>[ \t]?)+/gm, ''],
  [/^\[![^\]]*\][+-]?[ \t]*/gm, ''],
  // Headings and task checkboxes.
  [/^[ \t]{0,3}#{1,6}[ \t]+/gm, ''],
  [/^([ \t]*)[-*+][ \t]+\[.\][ \t]+/gm, '$1'],
  // A horizontal rule is not text.
  [/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, '\u0000'],
  // Emphasis and inline code.
  [/(\*\*|__|~~|==)(?=\S)([\s\S]*?\S)\1/g, '$2'],
  [/(^|[^\p{L}\p{N}*_])([*_])(?=\S)([^*_\n]*?\S)\2(?=[^\p{L}\p{N}*_]|$)/gmu, '$1$3'],
  [/`([^`\n]*)`/g, '$1'],
  // Removed inline markup leaves runs of spaces.
  [/(\S)[ \t]{2,}/g, '$1 '],
];

/**
 * First lines of text. For MD: removes properties, `%%…%%` and `<!-- -->` comments, `<script>`, `<style>`,
 * `<iframe>` with their content, other HTML tags and embeds; links become their text; strips the marks of
 * headings, quotes, callouts, task checkboxes, emphasis and code fence lines. TXT lines stay as is. Runs of
 * empty lines collapse to one, leading and trailing ones go; at most `EXCERPT_LINES` lines and
 * `EXCERPT_CHARS` characters. Nothing left after cleaning gives an empty string.
 */
export function excerptText(text: string, ext: string): string {
  let body = text.startsWith('﻿') ? text.slice(1) : text;
  if (ext.toLowerCase() === 'md') {
    body = body.replace(FRONT_MATTER, '');
    for (const pattern of DROPPED) body = body.replace(pattern, '');
    for (const [pattern, replacement] of MARKUP) body = body.replace(pattern, replacement);
  }
  const lines: string[] = [];
  for (const raw of body.split(/\r\n|\r|\n/)) {
    if (raw === '\u0000') continue; // a markup-only line removed entirely
    const line = raw.replace(/\s+$/, '');
    if (line === '' && (lines.length === 0 || lines[lines.length - 1] === '')) continue;
    lines.push(line);
    if (lines.length > EXCERPT_LINES) break;
  }
  const kept = lines.slice(0, EXCERPT_LINES).join('\n').trimEnd();
  return kept.length > EXCERPT_CHARS ? kept.slice(0, EXCERPT_CHARS).trimEnd() : kept;
}
