// Input checks for Buba agent commands, which take external input. Obsidian passes
// flags as strings and a bare flag as "true"; a failed check throws `CliError` with
// a code before any write. Paths are only from the vault root (OWASP Path Traversal:
// https://owasp.org/www-community/attacks/Path_Traversal). No `obsidian` import.
import { DATA_DIRS, normalizeTag, type Rating } from '../storage/types.ts';
import { CliError } from './answer.ts';

/** Call flags as Obsidian passes them to the handler. */
export type Params = Readonly<Record<string, string | undefined>>;

/**
 * Undeclared flags fail, as in `util.parseArgs({ strict: true })`: a typo must not silently drop a filter.
 */
export function checkFlags(params: Params, declared: readonly string[]): void {
  for (const name of Object.keys(params))
    if (!declared.includes(name)) throw new CliError('unknown-flag', name);
}

/**
 * The answer format is only `json`, also the default; Obsidian itself turns a bare `json` into `format=json`.
 */
export function checkFormat(params: Params): void {
  const { format } = params;
  if (format !== undefined && format !== 'json') throw new CliError('bad-format', format);
}

/** Backslash and control characters, including DEL. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const FORBIDDEN = /[\\\u0000-\u001f\u007f]/;
/** Start of an absolute path: root or a Windows drive (`C:…`). */
const ABSOLUTE = /^(\/|[A-Za-z]:)/;

/**
 * A file or folder path from the vault root as Obsidian writes it: parts joined by `/`, one trailing `/` of a
 * folder is dropped. Empty, absolute, with `\`, control characters, `.`, `..` or empty parts gives
 * `bad-path`. Inside the data folder (`__buba-data` or the legacy `Buba`), case-insensitive because on
 * Windows `buba/` is the same folder, gives `in-buba`.
 */
export function checkPath(raw: string | undefined): string {
  if (!raw || FORBIDDEN.test(raw) || ABSOLUTE.test(raw))
    throw new CliError('bad-path', JSON.stringify(raw ?? ''));
  const path = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..'))
    throw new CliError('bad-path', JSON.stringify(raw));
  if (DATA_DIRS.some((dir) => parts[0]?.toLowerCase() === dir.toLowerCase()))
    throw new CliError('in-buba', path);
  return path;
}

/**
 * Paths of a call: exactly one of `path=<path>` and `paths=<JSON array of strings>`, the array non-empty,
 * else `bad-paths`; each path goes through `checkPath`, duplicates are removed in order of first appearance.
 */
export function checkPaths(params: Params): string[] {
  const { path, paths } = params;
  if ((path === undefined) === (paths === undefined)) throw new CliError('bad-paths');
  if (path !== undefined) return [checkPath(path)];
  let list: unknown;
  try {
    list = JSON.parse(paths ?? '');
  } catch {
    throw new CliError('bad-paths', 'paths is not JSON');
  }
  if (!Array.isArray(list) || !list.length || !list.every((item) => typeof item === 'string'))
    throw new CliError('bad-paths', 'paths is not an array of strings or is empty');
  return [...new Set(list.map(checkPath))];
}

/** The tag after `normalizeTag`, in its original spelling; an empty one gives `bad-tag`. */
export function checkTag(raw: string | undefined): string {
  const tag = normalizeTag(raw ?? '');
  if (tag === null) throw new CliError('bad-tag');
  return tag;
}

/** Rating is exactly one digit 0…5 (0 means no rating), else `bad-rating`. */
export function checkRating(raw: string | undefined): Rating {
  if (raw === undefined || !/^[0-5]$/.test(raw)) throw new CliError('bad-rating', JSON.stringify(raw ?? ''));
  return Number(raw) as Rating;
}

/** Comment text, trimmed as the file panel writes it; empty after trimming gives `bad-text`. */
export function checkText(raw: string | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) throw new CliError('bad-text');
  return text;
}
