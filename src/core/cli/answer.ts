// Answer of Buba agent commands: always one JSON naming the vault where the action ran, either
// `{"ok":true,"vault",…data}` or `{"ok":false,"vault","error":{"code","message"},…data}`. The
// error envelope follows the Google JSON Style Guide
// (https://google.github.io/styleguide/jsoncstyleguide.xml#error). No `obsidian` import.

/**
 * Error codes of the whole commands module, kept in one place: commands take codes from here and never edit
 * it. The text starts `message`; the command appends the detail (path, flag, number) after a colon.
 */
export const ERRORS = {
  'bad-format': 'Answer format must be json',
  'unknown-flag': 'Unknown flag',
  'bad-path': 'Path must start at the vault root: no "\\", "." or "..", no empty parts, no drive',
  'in-buba': 'The Buba data folder is closed to commands',
  'not-found': 'No such file or folder',
  'not-a-file': 'This is a folder, a file is needed',
  'not-a-folder': 'This is a file, a folder is needed',
  'bad-paths': 'Paths need exactly one of the flags: path=<path> or paths=<non-empty JSON array of strings>',
  'bad-query': 'Invalid combination of flags',
  'bad-tag': 'Tag is empty',
  'bad-rating': 'Rating must be a whole number from 0 to 5',
  'bad-text': 'Text is empty',
  'no-comment': 'The file has no comment with this id',
  'not-a-canvas': 'This is not a .canvas board',
  'too-many': 'Too many cards in one call',
  'not-folder-or-canvas': 'Only a folder or a .canvas board can be opened',
  'not-applied': "Obsidian didn't open what was asked",
  'no-storage': "Storage of tags, ratings and comments didn't open",
  'bad-json': 'Not a JSON object',
  invalid: 'The passport is refused',
  'too-large': 'The passport is too large',
  'ref-not-found': 'References are not in the vault; save them as vault files first',
  'not-in-inbox': 'The request must be a .json file in __buba-data/inbox',
  internal: 'Internal Buba error',
} as const;

export type ErrorCode = keyof typeof ERRORS;

/** Answer data: fields next to `ok` and `vault`. */
export type Fields = Record<string, unknown>;

/** Command failure with an `ERRORS` code; `data` holds fields next to `error` (e.g. what opened instead). */
export class CliError extends Error {
  readonly code: ErrorCode;
  readonly data: Fields | undefined;

  constructor(code: ErrorCode, detail?: string, data?: Fields) {
    super(detail === undefined ? ERRORS[code] : `${ERRORS[code]}: ${detail}`);
    this.name = 'CliError';
    this.code = code;
    this.data = data;
  }
}

/** Success: `ok` and `vault` come first and data fields cannot override them. */
export function answer(vault: string, data: Fields = {}): string {
  return asciiJson(Object.assign({ ok: true, vault }, data, { ok: true, vault }));
}

/** Failure: `ok: false`, the vault, `error` with code and message; data fields cannot override them. */
export function refusal(vault: string, code: ErrorCode, message: string, data: Fields = {}): string {
  const error = { code, message };
  return asciiJson(Object.assign({ ok: false, vault, error }, data, { ok: false, vault, error }));
}

/**
 * One-line JSON of printable ASCII only: every character above 0x7E becomes `\uXXXX`, a surrogate pair two of
 * them, like Python's `json.dumps(ensure_ascii=True)`. The answer reads the same under any terminal code
 * page; `JSON.stringify` already escapes newlines inside values.
 */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
