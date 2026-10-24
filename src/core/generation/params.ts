// Rows of the generation parameters: known keys with a dictionary label in the order of the passport's kind,
// then other known keys in table order, then unknown keys as written with the key as the label; then the
// agent's own `shown` pairs and the cost. Every written parameter is shown. Extending the list is a row here
// and a label in the dictionary. No `obsidian` import.
import { t } from '../i18n/dict/generation.ts';
import { currentLanguage, PSEUDO } from '../i18n/index.ts';
import type { Passport, ParamValue, PassportCost } from '../storage/passport.ts';

type Label = Parameters<typeof t>[0];
type Look = 'plain' | 'seconds' | 'onOff' | 'yesNo' | 'factor';

/** Known keys in table order: dictionary label and value look. */
const KNOWN: ReadonlyArray<readonly [key: string, label: Label, look: Look]> = [
  ['aspectRatio', 'paramAspectRatio', 'plain'],
  ['resolution', 'paramResolution', 'plain'],
  ['duration', 'paramDuration', 'seconds'],
  ['audio', 'paramAudio', 'onOff'],
  ['mode', 'paramMode', 'plain'],
  ['quality', 'paramQuality', 'plain'],
  ['count', 'paramCount', 'plain'],
  ['voice', 'paramVoice', 'plain'],
  ['instrumental', 'paramInstrumental', 'yesNo'],
  ['format', 'paramFormat', 'plain'],
  ['factor', 'paramFactor', 'factor'],
  ['enhanceModel', 'paramEnhanceModel', 'plain'],
  ['faceEnhance', 'paramFaceEnhance', 'onOff'],
  ['seed', 'paramSeed', 'plain'],
];

/** Parameter keys the panel labels, for the agent guide (guide.ts). */
export const PARAM_KEYS: readonly string[] = KNOWN.map(([key]) => key);

const AUDIO_ORDER = ['duration', 'voice', 'instrumental', 'format'];

/**
 * A table value by a key from a passport: kinds and roles come from agents, so `constructor` or `toString` is
 * a kind or role like any other, not the object's own method.
 */
function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Key order of a kind; keys not named here follow in table order. */
const ORDER_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  image: ['aspectRatio', 'resolution', 'quality', 'count'],
  video: ['aspectRatio', 'resolution', 'duration', 'audio', 'mode', 'quality'],
  audio: AUDIO_ORDER,
  music: AUDIO_ORDER,
  speech: AUDIO_ORDER,
  sfx: AUDIO_ORDER,
  upscale: ['resolution', 'factor', 'enhanceModel', 'faceEnhance'],
};

/** Dictionary label of a known kind; other kinds are shown as written. */
const KIND_LABELS: Readonly<Record<string, Label>> = {
  image: 'kindImage',
  video: 'kindVideo',
  audio: 'kindAudio',
  music: 'kindMusic',
  speech: 'kindSpeech',
  sfx: 'kindSfx',
  '3d': 'kind3d',
  vector: 'kindVector',
  upscale: 'kindUpscale',
  'remove-background': 'kindRemoveBackground',
  edit: 'kindEdit',
  expand: 'kindExpand',
  relight: 'kindRelight',
  lipsync: 'kindLipsync',
  'voice-change': 'kindVoiceChange',
  other: 'kindOther',
};

/** Kinds the panel labels, for the agent guide (guide.ts). */
export const KINDS: readonly string[] = Object.keys(KIND_LABELS);

const ROLE_LABELS: Readonly<Record<string, Label>> = {
  'first-frame': 'roleFirstFrame',
  'last-frame': 'roleLastFrame',
  source: 'roleSource',
  mask: 'roleMask',
  style: 'roleStyle',
  voice: 'roleVoice',
  'driving-audio': 'roleDrivingAudio',
};

export function kindLabel(kind: string): string {
  const label = own(KIND_LABELS, kind);
  return label ? t(label) : kind;
}

/**
 * Icons of known roles, the badge on a reference thumbnail; the label goes to the hover text. First and last
 * frame are the media player's "to start" and "to end", as in video generators and editors.
 */
const ROLE_ICONS: Readonly<Record<string, string>> = {
  'first-frame': 'skip-back',
  'last-frame': 'skip-forward',
  source: 'file-input',
  mask: 'venetian-mask',
  style: 'palette',
  voice: 'mic',
  'driving-audio': 'audio-lines',
};

/** Role badge text: the dictionary label of a known role, an unknown one as written. */
export function roleLabel(role: string): string {
  const label = own(ROLE_LABELS, role);
  return label ? t(label) : role;
}

/** Badge icon of a known role; `null` for an unknown one, which is shown as text. */
export function roleIcon(role: string): string | null {
  return own(ROLE_ICONS, role) ?? null;
}

export interface ParamRow {
  /** Parameter key, `shown` for the agent's pairs and `cost` for the cost. */
  key: string;
  label: string;
  value: string;
}

/**
 * A parameter number in the current Buba language without digit grouping: a seed or an id reads as written
 * (482193, not 482 193); the decimal sign follows the language.
 */
function number(value: number): string {
  const language = currentLanguage();
  return new Intl.NumberFormat(language === PSEUDO ? 'en' : language, {
    useGrouping: false,
    maximumFractionDigits: 20,
  }).format(value);
}

function show(value: ParamValue, look: Look): string {
  if (typeof value === 'boolean') {
    if (look === 'yesNo') return t(value ? 'yes' : 'no');
    return t(value ? 'on' : 'off');
  }
  if (typeof value === 'number') {
    if (look === 'seconds') return t('seconds', { value });
    if (look === 'factor') return t('factor', { value });
    return number(value);
  }
  return value;
}

export function costText({ amount, unit }: PassportCost): string {
  const kind = unit.toLowerCase();
  if (kind === 'usd') return t('costUsd', { value: amount });
  if (kind === 'credits') return t('costCredits', { count: amount });
  if (kind === 'tokens') return t('costTokens', { count: amount });
  return t('costOther', { value: amount, unit });
}

/** All rows of a passport in panel order. */
export function paramRows(passport: Passport): ParamRow[] {
  const params = passport.params ?? {};
  const known = new Map(KNOWN.map((row) => [row[0], row]));
  const order = [...(own(ORDER_BY_KIND, passport.kind) ?? [])];
  for (const [key] of KNOWN) if (!order.includes(key)) order.push(key);
  const rows: ParamRow[] = [];
  for (const key of order) {
    const value = params[key];
    const row = known.get(key);
    if (value === undefined || !row) continue;
    rows.push({ key, label: t(row[1]), value: show(value, row[2]) });
  }
  for (const [key, value] of Object.entries(params)) {
    if (!known.has(key)) rows.push({ key, label: key, value: show(value, 'onOff') });
  }
  for (const { label, value } of passport.shown ?? []) rows.push({ key: 'shown', label, value });
  if (passport.cost) rows.push({ key: 'cost', label: t('paramCost'), value: costText(passport.cost) });
  return rows;
}
