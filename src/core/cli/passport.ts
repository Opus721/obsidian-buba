// Parsing of `buba:passport` and of an inbox request: which file, which passport, which board. The passport
// itself is checked by storage rules (src/core/storage/passport.ts) before anything is written; here only the
// call shape. Failures throw `CliError`. No `obsidian` import.
import { DEFAULT_KIND, isInboxRequest, readInboxRequest, REQUEST_MAX_BYTES } from '../inbox/request.ts';
import { CliError } from './answer.ts';
import { checkPath, type Params } from './input.ts';

/** What to write: `passport` is the agent's raw object, `null` removes the passport. */
export interface PassportCall {
  path: string;
  passport: unknown;
  canvas?: string;
}

/** `file=` reads the request from the inbox; the caller reads the file and passes its text to `passportRequest`. */
export type PassportQuery = PassportCall | { file: string; canvas?: string };

/** Board flag: a vault path ending in `.canvas`. */
function canvasOf(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const canvas = checkPath(raw);
  if (!canvas.endsWith('.canvas')) throw new CliError('not-a-canvas', canvas);
  return canvas;
}

/** JSON object text; anything else gives `bad-json` with the parser's reason. */
export function jsonObject(text: string, what: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new CliError('bad-json', `${what}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CliError('bad-json', `${what} is not an object`);
  return value as Record<string, unknown>;
}

/** A request file path in the inbox (`isInboxRequest`), `\\` read as `/`; otherwise `not-in-inbox`. */
export function checkInboxFile(raw: string | undefined): string {
  const path = (raw ?? '').replaceAll('\\', '/');
  if (!isInboxRequest(path)) throw new CliError('not-in-inbox', JSON.stringify(raw ?? ''));
  return path;
}

/**
 * Flags of `buba:passport`: `path` with `passport=<JSON>` or `clear`, or `file=<request>`; `canvas` with any
 * of them except `clear`. Any other mix gives `bad-query`.
 */
export function parsePassportCall(params: Params): PassportQuery {
  const { path, passport, file, canvas, clear } = params;
  const cleared = clear !== undefined && clear !== 'false';
  if (file !== undefined) {
    if (path !== undefined || passport !== undefined || cleared)
      throw new CliError('bad-query', 'file= goes without path, passport and clear');
    return { file: checkInboxFile(file), ...optional('canvas', canvasOf(canvas)) };
  }
  const target = checkPath(path);
  if (cleared) {
    if (passport !== undefined || canvas !== undefined)
      throw new CliError('bad-query', 'clear goes with path only');
    return { path: target, passport: null };
  }
  if (passport === undefined) throw new CliError('bad-query', 'path needs passport=<JSON>, or use file=');
  if (passport.length > REQUEST_MAX_BYTES)
    throw new CliError(
      'too-large',
      `passport is longer than ${REQUEST_MAX_BYTES / 1024} KB of text, not read`,
    );
  return {
    path: target,
    passport: jsonObject(passport, 'passport'),
    ...optional('canvas', canvasOf(canvas)),
  };
}

/** Request file text of `file=`: a JSON object of kind `passport`, else `bad-json` or `bad-query`. */
export function passportRequestText(text: string, canvas?: string): PassportCall {
  const reading = readInboxRequest(text);
  if (!reading.ok) throw new CliError('bad-json', `request is ${reading.reason}`);
  if (reading.kind !== DEFAULT_KIND)
    throw new CliError('bad-query', `request kind is ${JSON.stringify(reading.kind)}, not "passport"`);
  return passportRequest(reading.request, canvas);
}

/**
 * A passport request, from the inbox or `file=`: `{kind?, path, passport, canvas?}`. `canvas` given by the
 * command wins over the request's own; `passport: null` removes the passport.
 */
export function passportRequest(request: Record<string, unknown>, canvas?: string): PassportCall {
  if (typeof request.path !== 'string') throw new CliError('bad-path', 'request has no path');
  const target = checkPath(request.path);
  if (request.canvas !== undefined && typeof request.canvas !== 'string')
    throw new CliError('bad-path', 'request canvas is not text');
  const board = canvas ?? canvasOf(request.canvas);
  if (request.passport === null) return { path: target, passport: null };
  if (typeof request.passport !== 'object' || Array.isArray(request.passport))
    throw new CliError('bad-json', 'request has no passport object');
  return { path: target, passport: request.passport, ...optional('canvas', board) };
}

/** `{ key: value }` when the value is set, otherwise nothing: no `undefined` fields in the answer. */
function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
