// Generation passport: what a generated file was made with (kind, model, provider, prompt, ordered references,
// parameters, cost, date, who), written by an agent and kept as a `gen.set` journal line in the file's path
// record. A passport is external input twice over: an agent writes it, and sync brings it from
// another device. Two readings share one set of rules: `input` is forgiving about form (trims, lower-cases the
// kind, turns `\` into `/`, takes any date `Date.parse` reads, drops `null` parameters, stores a short object
// parameter as its JSON text) and never about content; `line` is strict, for journal lines, and accepts only
// what `input` would produce. An unknown kind, role or parameter is never refused: the defining defect of the
// old Buba was a narrow guess refusing valid provider data. No `obsidian` import.
import { DATA_DIRS, type Fingerprint } from './types.ts';

/** Kind of generation: `[a-z0-9-]`, like `video`, `upscale`, `remove-background`; unknown kinds are kept. */
export const KIND_MAX = 40;
/** Model, provider: people's names. */
export const NAME_MAX = 200;
/** Who generated it: an agent or a person. */
export const BY_MAX = 100;
/** Prompt, negative prompt, lyrics; Seedance 2.5 on ArtCraft takes up to 10,000 characters. */
export const TEXT_MAX = 20_000;
/** References; Seedance 2.5 on ArtCraft takes up to 50 images. */
export const REFS_MAX = 100;
/** A reference's role and its tag in the prompt. */
export const ROLE_MAX = 40;
export const TOKEN_MAX = 40;
/** Parameters: key, text value, number of keys. */
export const PARAM_KEY_MAX = 100;
export const PARAM_VALUE_MAX = 200;
export const PARAMS_MAX = 100;
/** Parameters shown under the agent's own label. */
export const SHOWN_MAX = 20;
export const SHOWN_LABEL_MAX = 100;
export const SHOWN_VALUE_MAX = 200;
/** Cost unit: `usd`, `credits`, `tokens` or short text. */
export const UNIT_MAX = 20;
/** Service fields as JSON text. */
export const HIDDEN_MAX = 32 * 1024;
/** The whole journal line; a longer one is refused before writing (`too-large`). */
export const LINE_MAX = 96 * 1024;

/** Known roles; any other role is kept as written and shown by file type. */
export const KNOWN_ROLES = [
  'image',
  'video',
  'audio',
  'first-frame',
  'last-frame',
  'source',
  'mask',
  'style',
  'voice',
  'driving-audio',
] as const;

export interface PassportRef {
  /** Path from the vault root, outside the data folders. */
  path: string;
  role: string;
  /** The tag the agent used for this reference in the prompt, when it is not `ImageN`, `VideoN`, `AudioN`. */
  token?: string;
  /** Written by storage, never by the agent: finds a reference moved while Buba was not looking. */
  fp?: Fingerprint;
}

export type ParamValue = string | number | boolean;

export interface ShownParam {
  label: string;
  value: string;
}

export interface PassportCost {
  amount: number;
  unit: string;
}

/** A checked passport; absent optional fields are left out, not empty. */
export interface Passport {
  kind: string;
  model: string;
  provider: string;
  /** `toISOString()` form. */
  createdAt: string;
  by?: string;
  prompt?: string;
  negativePrompt?: string;
  lyrics?: string;
  refs?: PassportRef[];
  params?: Record<string, ParamValue>;
  shown?: ShownParam[];
  cost?: PassportCost;
  /** Service ids only (job id, request id, API model name, raw answer): never drawn in the panel. */
  hidden?: Record<string, unknown>;
}

/** Why a passport is refused: the field and the reason, in English for agents and logs. */
export interface PassportFault {
  code: 'invalid' | 'too-large';
  field: string;
  reason: string;
}

export type PassportReading = { ok: true; passport: Passport } | { ok: false; fault: PassportFault };

/**
 * Control characters other than tab, line feed and carriage return, plus direction overrides and isolates: a
 * reordered text would show one thing and copy another. Zero-width joiners stay: emoji sequences use them.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

const KIND = /^[a-z0-9-]+$/;

/** Time exactly in `toISOString()` form, as journal times (journal.ts `isTime`). */
export function isIsoTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const ms = Date.parse(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString() === value;
}

/**
 * A vault file path as Obsidian writes it: parts joined by `/`, no empty, `.` or `..` parts, no leading `/`,
 * no drive, not in a Buba data folder.
 */
export function isVaultFilePath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || CONTROL.test(value) || value.includes('\\')) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return false;
  // Case-insensitive, as in the command path check: on Windows `buba/` is the same folder as `Buba/`.
  const top = parts[0]?.toLowerCase() ?? '';
  return !DATA_DIRS.some((dir) => dir.toLowerCase() === top);
}

class Refused extends Error {
  readonly field: string;
  readonly reason: string;

  constructor(field: string, reason: string) {
    super(`${field}: ${reason}`);
    this.field = field;
    this.reason = reason;
  }
}

/** Storage refuses a passport before writing: `fault` says which field and why. */
export class PassportRefused extends RangeError {
  readonly fault: PassportFault;

  constructor(fault: PassportFault) {
    super(`Passport refused: ${fault.field} ${fault.reason}`);
    this.name = 'PassportRefused';
    this.fault = fault;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type Mode = 'input' | 'line';

/** Text field: a string within `max` characters, no control characters; empty is refused when `required`. */
function text(value: unknown, field: string, max: number, mode: Mode, required = true): string {
  if (typeof value !== 'string') throw new Refused(field, 'must be text');
  const shown = mode === 'input' && max <= NAME_MAX ? value.trim() : value;
  if (required && shown.trim() === '') throw new Refused(field, 'is empty');
  if (shown.length > max) throw new Refused(field, `is longer than ${max} characters`);
  if (CONTROL.test(shown)) throw new Refused(field, 'has control or direction characters');
  return shown;
}

/** Optional long text (prompt, negative prompt, lyrics): absent, `null` or empty input means none. */
function longText(value: unknown, field: string, mode: Mode): string | undefined {
  if (value === undefined || (mode === 'input' && (value === null || value === ''))) return undefined;
  return text(value, field, TEXT_MAX, mode);
}

function kindOf(value: unknown, mode: Mode): string {
  const raw = typeof value === 'string' && mode === 'input' ? value.trim().toLowerCase() : value;
  const kind = text(raw, 'kind', KIND_MAX, mode);
  if (!KIND.test(kind)) throw new Refused('kind', 'may hold only a-z, 0-9 and "-"');
  return kind;
}

/**
 * Input takes any date `Date` reads, a string or milliseconds, and stores its `toISOString()` form; a date that
 * form cannot hold in four year digits (year 10000 on, before year 0, seconds or microseconds taken for
 * milliseconds) is refused, or the line would be written and then read as broken.
 */
function timeOf(value: unknown, mode: Mode): string {
  if (isIsoTime(value)) return value;
  let ms = NaN;
  if (mode === 'input' && typeof value === 'string' && value.trim() !== '') ms = Date.parse(value.trim());
  else if (mode === 'input' && typeof value === 'number') ms = value;
  const date = new Date(ms);
  const iso = Number.isNaN(date.getTime()) ? null : date.toISOString();
  if (iso !== null && isIsoTime(iso)) return iso;
  throw new Refused(
    'createdAt',
    'must be a date and time between years 0000 and 9999, like 2026-10-23T08:00:00.000Z or milliseconds',
  );
}

function fingerprintOf(value: unknown, field: string): Fingerprint {
  if (!isObject(value)) throw new Refused(field, 'must be an object');
  const { size, mtime, name } = value;
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0)
    throw new Refused(`${field}.size`, 'must be a number');
  if (typeof mtime !== 'number' || !Number.isFinite(mtime))
    throw new Refused(`${field}.mtime`, 'must be a number');
  if (typeof name !== 'string' || name === '' || CONTROL.test(name) || name.includes('/'))
    throw new Refused(`${field}.name`, 'must be a file name');
  return { size, mtime, name };
}

function refsOf(value: unknown, mode: Mode): PassportRef[] | undefined {
  if (value === undefined || (mode === 'input' && value === null)) return undefined;
  if (!Array.isArray(value)) throw new Refused('refs', 'must be a list');
  if (value.length > REFS_MAX) throw new Refused('refs', `has more than ${REFS_MAX} references`);
  if (!value.length) return undefined;
  return value.map((raw: unknown, i): PassportRef => {
    const at = `refs[${i}]`;
    // An agent may give a reference as a bare path string: the role then follows the file type.
    const item = mode === 'input' && typeof raw === 'string' ? { path: raw } : raw;
    if (!isObject(item)) throw new Refused(at, 'must be an object with path and role');
    let path = item.path;
    if (mode === 'input' && typeof path === 'string')
      path = path.trim().replaceAll('\\', '/').replace(/^\.\//, '');
    if (!isVaultFilePath(path))
      throw new Refused(`${at}.path`, 'must be a file path from the vault root, outside __buba-data');
    let role = item.role;
    if (mode === 'input' && (role === undefined || role === null || role === '')) role = 'file';
    if (mode === 'input' && typeof role === 'string') role = role.trim().toLowerCase();
    const ref: PassportRef = { path, role: text(role, `${at}.role`, ROLE_MAX, mode) };
    const token = item.token;
    if (token !== undefined && !(mode === 'input' && (token === null || token === ''))) {
      const tag = text(
        typeof token === 'string' && mode === 'input' ? token.trim() : token,
        `${at}.token`,
        TOKEN_MAX,
        mode,
      );
      if (/\s/.test(tag)) throw new Refused(`${at}.token`, 'must be one word');
      ref.token = tag;
    }
    if (mode === 'line' && item.fp !== undefined) ref.fp = fingerprintOf(item.fp, `${at}.fp`);
    return ref;
  });
}

function paramsOf(value: unknown, mode: Mode): Record<string, ParamValue> | undefined {
  if (value === undefined || (mode === 'input' && value === null)) return undefined;
  if (!isObject(value)) throw new Refused('params', 'must be an object');
  const out: Record<string, ParamValue> = {};
  let count = 0;
  for (const [rawKey, raw] of Object.entries(value)) {
    const key = mode === 'input' ? rawKey.trim() : rawKey;
    if (key === '' || key.length > PARAM_KEY_MAX || CONTROL.test(key))
      throw new Refused('params', `key ${JSON.stringify(rawKey)} must be 1-${PARAM_KEY_MAX} characters`);
    const field = `params.${key}`;
    let item: unknown = raw;
    if (mode === 'input') {
      if (item === null || item === undefined || item === '') continue;
      // A short list or object (LoRA names, a crop box) is kept as its JSON text, so it stays visible.
      if (typeof item === 'object') {
        item = JSON.stringify(item);
        if ((item as string).length > PARAM_VALUE_MAX)
          throw new Refused(
            field,
            `is a list or object longer than ${PARAM_VALUE_MAX} characters as JSON; put it in hidden`,
          );
      }
    }
    if (typeof item === 'boolean') out[key] = item;
    else if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Refused(field, 'must be a finite number');
      // JSON reading has already rounded a whole number past 2^53 (a 64-bit seed): storing it would show and
      // copy a different number, so the agent is asked for the digits as text.
      if (Number.isInteger(item) && !Number.isSafeInteger(item))
        throw new Refused(
          field,
          'is a whole number too large to keep exactly; send it as text, like "18446744073709551615"',
        );
      out[key] = item;
    } else if (typeof item === 'string') out[key] = text(item, field, PARAM_VALUE_MAX, mode);
    else throw new Refused(field, 'must be text, a number or true/false');
    if (++count > PARAMS_MAX) throw new Refused('params', `has more than ${PARAMS_MAX} keys`);
  }
  return count ? out : undefined;
}

function shownOf(value: unknown, mode: Mode): ShownParam[] | undefined {
  if (value === undefined || (mode === 'input' && value === null)) return undefined;
  if (!Array.isArray(value)) throw new Refused('shown', 'must be a list of {label, value}');
  if (value.length > SHOWN_MAX) throw new Refused('shown', `has more than ${SHOWN_MAX} items`);
  if (!value.length) return undefined;
  return value.map((item, i) => {
    if (!isObject(item)) throw new Refused(`shown[${i}]`, 'must be {label, value}');
    if (typeof item.value === 'number' && Number.isInteger(item.value) && !Number.isSafeInteger(item.value))
      throw new Refused(`shown[${i}].value`, 'is a whole number too large to keep exactly; send it as text');
    const raw =
      mode === 'input' && (typeof item.value === 'number' || typeof item.value === 'boolean')
        ? String(item.value)
        : item.value;
    return {
      label: text(item.label, `shown[${i}].label`, SHOWN_LABEL_MAX, mode),
      value: text(raw, `shown[${i}].value`, SHOWN_VALUE_MAX, mode),
    };
  });
}

function costOf(value: unknown, mode: Mode): PassportCost | undefined {
  if (value === undefined || (mode === 'input' && value === null)) return undefined;
  if (!isObject(value)) throw new Refused('cost', 'must be {amount, unit}');
  const amount = mode === 'input' && typeof value.amount === 'string' ? Number(value.amount) : value.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)
    throw new Refused('cost.amount', 'must be a number, 0 or more');
  return { amount, unit: text(value.unit, 'cost.unit', UNIT_MAX, mode) };
}

function hiddenOf(value: unknown, mode: Mode): Record<string, unknown> | undefined {
  if (value === undefined || (mode === 'input' && value === null)) return undefined;
  if (!isObject(value)) throw new Refused('hidden', 'must be an object');
  const json = JSON.stringify(value);
  if (json.length > HIDDEN_MAX)
    throw new Refused('hidden', `is longer than ${HIDDEN_MAX} characters as JSON`);
  if (json === '{}') return undefined;
  // A copy through JSON: no prototype tricks, no functions, the same thing the journal will hold.
  return JSON.parse(json) as Record<string, unknown>;
}

function read(raw: unknown, mode: Mode): Passport {
  if (!isObject(raw)) throw new Refused('passport', 'must be a JSON object');
  const passport: Passport = {
    kind: kindOf(raw.kind, mode),
    model: text(raw.model, 'model', NAME_MAX, mode),
    provider: text(raw.provider, 'provider', NAME_MAX, mode),
    createdAt: timeOf(raw.createdAt, mode),
  };
  if (raw.by !== undefined && !(mode === 'input' && (raw.by === null || raw.by === '')))
    passport.by = text(raw.by, 'by', BY_MAX, mode);
  const prompt = longText(raw.prompt, 'prompt', mode);
  if (prompt !== undefined) passport.prompt = prompt;
  const negative = longText(raw.negativePrompt, 'negativePrompt', mode);
  if (negative !== undefined) passport.negativePrompt = negative;
  const lyrics = longText(raw.lyrics, 'lyrics', mode);
  if (lyrics !== undefined) passport.lyrics = lyrics;
  const refs = refsOf(raw.refs, mode);
  if (refs) passport.refs = refs;
  const params = paramsOf(raw.params, mode);
  if (params) passport.params = params;
  const shown = shownOf(raw.shown, mode);
  if (shown) passport.shown = shown;
  const cost = costOf(raw.cost, mode);
  if (cost) passport.cost = cost;
  const hidden = hiddenOf(raw.hidden, mode);
  if (hidden) passport.hidden = hidden;
  return passport;
}

/**
 * An agent's passport, forgiving about form (see the file header); fingerprints the agent wrote are dropped,
 * storage writes its own. Refused with the field and the reason.
 */
export function readPassportInput(raw: unknown): PassportReading {
  try {
    return { ok: true, passport: read(raw, 'input') };
  } catch (error) {
    if (error instanceof Refused)
      return { ok: false, fault: { code: 'invalid', field: error.field, reason: error.reason } };
    throw error;
  }
}

/** A passport from a journal line: strict, the form `readPassportInput` produces; `null` if it is not. */
export function readPassportLine(raw: unknown): Passport | null {
  try {
    return read(raw, 'line');
  } catch (error) {
    if (error instanceof Refused) return null;
    throw error;
  }
}

/**
 * Comparison key of two passports: the JSON of the passport without reference fingerprints, which differ by
 * device and file edits; the same agent request replayed (two devices taking one inbox request) is equal.
 */
export function passportKey(passport: Passport | null): string {
  if (!passport) return 'null';
  const { refs, ...rest } = passport;
  return JSON.stringify({ ...rest, refs: refs?.map(({ fp: _fp, ...ref }) => ref) });
}

/** Reference paths of a passport in its order, each once. */
export function refPaths(passport: Passport | null): string[] {
  return [...new Set(passport?.refs?.map((ref) => ref.path) ?? [])];
}
