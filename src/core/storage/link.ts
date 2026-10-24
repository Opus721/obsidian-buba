// A file's link: a page address (a pin, a brief, Figma) that the file panel opens in the system browser. The
// link arrives as a journal line from another device, so it is external input and only http and https are
// accepted, like Obsidian's strict address check (app.js 1.13.7, "http(s) only"): `javascript:`, `file:`,
// `obsidian:` and other schemes are never opened. No `obsidian` import.

/** Length limit: Figma and Google Docs addresses are 100-300 characters. */
export const LINK_MAX = 2048;

/**
 * Whitespace, control characters and invisible characters: format characters (`\p{Cf}`: direction overrides,
 * zero-width) and everything skipped when shown (`\p{Default_Ignorable_Code_Point}`: Hangul fillers U+3164
 * and U+FFA0, variation selectors, U+034F and the like). The URL parser silently drops some of them, a
 * direction override would show a different address in the field than the one opened, and fillers hide part
 * of the address: `https://www.figma.com` + 40 x U+3164 + `@evil.example/` looks like a Figma address in the
 * field but opens `evil.example`.
 */
const HIDDEN = /[\s\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

/**
 * Invisible characters get their own field notice; space, no-break space and control
 * characters are not among them.
 */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

/**
 * Address start: `http://` or `https://`, scheme in any case, and right after `//` neither `/`
 * nor `\`. For http and https the URL parser skips any number of `/` and `\` after `scheme:`, or
 * none at all: `https:www.figma.com…` and `https:///www.figma.com…` would open, but the host part
 * below would not see them.
 */
const START = /^https?:\/\/(?![/\\])/i;

/** Host part of the typed address: after `http://` or `https://` up to the first `/`, `?`, `#` or `\`. */
const HOST_PART = /^https?:\/\/([^/?#\\]*)/i;

/**
 * Host part characters: letters, marks, digits, `-`, `.`, `:` (port) and `[]` (IPv6); the part is not empty.
 * A filler that is not invisible, such as the blank Braille pattern U+2800 or U+1D159, hides a subdomain in
 * the host name: `https://www.figma.com` + 40 x U+2800 + `.evil.example/` opens the `evil.example` subdomain.
 * The host is taken from the typed text, not from `URL.host`, because in the parsed host the filler is
 * already rewritten to `xn--`.
 */
const HOST_CHARS = /^[\p{L}\p{M}\p{N}\-.:[\]]+$/u;

/**
 * Letters and marks with a blank glyph that pass the host character check: Egyptian hieroglyph spaces U+13441
 * and U+13442, the Khitan filler U+16FE4. A host part containing one is refused by this list.
 */
const BLANK_LETTERS = /\u{13441}|\u{13442}|\u{16FE4}/u;

/**
 * Why a value is not a link, in check order: `hidden` is an invisible character; `credentials` is an http or
 * https address with a user name or password before `@` (`https://www.figma.com…@evil.example/` opens
 * `evil.example`; a valid URL string never carries them, https://url.spec.whatwg.org/#url-writing); `other`
 * is the rest: not http or https, whitespace, a control character, longer than `LINK_MAX`, the address start,
 * host characters. `null` if valid.
 */
export type LinkFault = 'hidden' | 'credentials' | 'other';

export function linkFault(value: unknown): LinkFault | null {
  if (typeof value !== 'string' || value === '') return 'other';
  if (INVISIBLE.test(value)) return 'hidden';
  if (value.length > LINK_MAX || HIDDEN.test(value)) return 'other';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'other';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'other';
  if (url.username !== '' || url.password !== '') return 'credentials';
  const host = HOST_PART.exec(value)?.[1] ?? '';
  if (!START.test(value) || !HOST_CHARS.test(host) || BLANK_LETTERS.test(host)) return 'other';
  return null;
}

/**
 * Valid link: `http://` or `https://` both by the URL parser and by the typed start, no hidden characters, no
 * user name or password, only host characters in the host part, no longer than `LINK_MAX`.
 */
export function isLinkUrl(value: unknown): value is string {
  return linkFault(value) === null;
}

/**
 * Typed or pasted text to a link: edges trimmed (a newline or an invisible character at the start of a
 * paste), the rest as typed, like an Obsidian link property; invalid gives `null`. Empty also gives `null`:
 * removing the link is the caller's decision. `https://` is not added to an address without a scheme, because
 * Obsidian does not do that.
 */
export function normalizeLink(text: string): string | null {
  const url = text.trim();
  return isLinkUrl(url) ? url : null;
}
