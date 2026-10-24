// Inbox requests: agents without the Obsidian command line drop `<name>.json` into the inbox folder inside
// the data folder, and the plugin takes it. The shared form is a JSON object with `kind` choosing the handler
// (`passport` when absent); a module registers its kind (src/platform/inbox.ts). Unknown kinds are left in
// place for a newer version. No `obsidian` import.
import { JOURNAL_DIR } from '../storage/types.ts';

/** The inbox folder: requests of agents that have no Obsidian command line. */
export const INBOX_DIR = `${JOURNAL_DIR}/inbox`;
/** Refused and expired requests, each next to `<name>.reason.txt`. */
export const REJECTED_DIR = `${INBOX_DIR}/rejected`;
/** A request whose files have not arrived yet is retried this long, then refused, ms. */
export const INBOX_WAIT_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * A request file larger than this is refused unread, bytes. One passport is a journal line of at most 96 KB;
 * indented JSON and escapes take more room, so the limit is generous. Without it a raw provider answer with
 * base64 media of hundreds of MB would be read whole, on a phone too, at every start.
 */
export const REQUEST_MAX_BYTES = 512 * 1024;
/** Kind of a request without `kind`. */
export const DEFAULT_KIND = 'passport';

/**
 * The request file as Obsidian names it, if `path` is one: `<name>.json` directly in the inbox, the folder
 * names in any case (on Windows `Inbox` is the same folder). A writer puts `<name>.json.tmp` first and
 * renames it, so a half-written request never matches.
 */
export function isInboxRequest(path: string): boolean {
  const prefix = `${INBOX_DIR}/`;
  if (path.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return false;
  const name = path.slice(prefix.length);
  return name.length > '.json'.length && !name.includes('/') && name.toLowerCase().endsWith('.json');
}

/** File name of a request without the folder. */
export const requestName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** Where a refused request goes, and its reason file. */
export function rejectedPaths(
  path: string,
  taken: (path: string) => boolean,
): { file: string; reason: string } {
  const name = requestName(path);
  const stem = name.slice(0, -'.json'.length);
  for (let n = 1; ; n++) {
    const base = n === 1 ? stem : `${stem}-${n}`;
    const file = `${REJECTED_DIR}/${base}.json`;
    const reason = `${REJECTED_DIR}/${base}.reason.txt`;
    if (!taken(file) && !taken(reason)) return { file, reason };
  }
}

export type InboxReading =
  { ok: true; kind: string; request: Record<string, unknown> } | { ok: false; reason: string };

/** Request text to its kind and object; anything but a JSON object with a text `kind` is refused. */
export function readInboxRequest(text: string): InboxReading {
  let value: unknown;
  try {
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    return { ok: false, reason: `not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { ok: false, reason: 'not a JSON object' };
  const request = value as Record<string, unknown>;
  const kind = request.kind ?? DEFAULT_KIND;
  if (typeof kind !== 'string' || kind.trim() === '') return { ok: false, reason: 'kind must be text' };
  return { ok: true, kind: kind.trim().toLowerCase(), request };
}

/** A waiting request past its time: `since` is when it appeared (the earlier of creation and change). */
export const expired = (since: number, now: number): boolean => now - since >= INBOX_WAIT_MS;
