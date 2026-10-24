// Buba UI translation, without the `obsidian` import. Buba follows Obsidian's language: the language tag
// (`getLanguage()`, src/platform/locale.ts) is looked up in `LANGUAGES`, falling back to English. There is no
// separate setting, as in Obsidian itself; the language is set once on plugin load (`setLanguage`), and
// changing the Obsidian language restarts the window. Dictionaries are per module in
// `src/core/i18n/dict/<module>.ts` (plain data used by both core and UI): `en` is the key source, complete
// languages have the same key set (checked by types and a test), partial ones fall
// back to English per key. Plurals use the language's `Intl.PluralRules` categories, numbers in substitutions
// its `Intl.NumberFormat`. The pseudo language `en-XA` (as in Android and Chromium) lengthens English text
// and swaps letters to catch untranslated and truncated text; tests and debugging only.

/**
 * Buba languages: Obsidian language code to translation status. `source` is English, the key source;
 * `complete` means every dictionary must translate all keys; `partial` takes missing keys from English. A new
 * language is one line here plus its dictionaries.
 */
export const LANGUAGES = {
  en: 'source',
  ru: 'complete',
} as const satisfies Record<string, 'source' | 'complete' | 'partial'>;

export type Language = keyof typeof LANGUAGES;
type LanguagesOf<Status> = { [L in Language]: (typeof LANGUAGES)[L] extends Status ? L : never }[Language];
export type CompleteLanguage = LanguagesOf<'complete'>;
export type PartialLanguage = LanguagesOf<'partial'>;

/** Pseudo language for checks: not an Obsidian language, enabled only by tests or debugging. */
export const PSEUDO = 'en-XA';
export type UiLanguage = Language | typeof PSEUDO;

/** Plural forms by `Intl.PluralRules` category; every language has `other`. */
export type Forms = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;
export type Entry = string | Forms;
export type Source = Record<string, Entry>;
/** Translation of dictionary `S`: strings stay strings, plural forms use the target language's forms. */
export type Translation<S extends Source> = { [K in keyof S]: S[K] extends string ? string : Forms };
/** A module dictionary: the English source, complete languages in full, partial ones in part. */
export type Dictionary<S extends Source> = { en: S } & { [L in CompleteLanguage]: Translation<S> } & {
  [L in PartialLanguage]?: Partial<Translation<S>>;
};
export type Vars = Record<string, string | number>;
/** Translation arguments: a key with plural forms requires `count`. */
export type Args<E> = E extends string ? [vars?: Vars] : [vars: Vars & { count: number }];

let current: UiLanguage = 'en';

/** Buba language for an Obsidian tag ("ru", "en-GB"): the whole tag, then its primary part, else English. */
export function pickLanguage(tag: string | undefined): Language {
  if (!tag) return 'en';
  const lower = tag.toLowerCase();
  const codes = Object.keys(LANGUAGES) as Language[];
  for (const candidate of [lower, lower.split('-')[0]]) {
    const hit = codes.find((code) => code.toLowerCase() === candidate);
    if (hit) return hit;
  }
  return 'en';
}

export function setLanguage(language: UiLanguage): void {
  current = language;
}

export function currentLanguage(): UiLanguage {
  return current;
}

/**
 * Translates `key` of `dictionary` into the current language, falling back to the English text. Plural forms
 * follow `vars.count` and the rules of the language whose text was used; `{name}` takes the value from `vars`
 * (numbers formatted for the language), an unknown name stays as is.
 */
export function translate<S extends Source>(
  dictionary: Dictionary<S>,
  key: keyof S & string,
  vars?: Vars,
): string {
  const pseudo = current === PSEUDO;
  const language: Language = pseudo ? 'en' : (current as Language);
  const own =
    language === 'en' ? undefined : (dictionary[language as keyof Dictionary<S>] as Partial<Source>)?.[key];
  const from: Language = own === undefined ? 'en' : language;
  const entry: Entry = own ?? dictionary.en[key] ?? key;
  const count = vars?.count;
  const text =
    typeof entry === 'string'
      ? entry
      : (entry[new Intl.PluralRules(from).select(typeof count === 'number' ? count : Number.NaN)] ??
        entry.other);
  const template = pseudo ? pseudoText(text) : text;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars?.[name];
    if (value === undefined) return whole;
    return typeof value === 'number' ? new Intl.NumberFormat(from).format(value) : value;
  });
}

/** Translator for a module dictionary: `t('key')`, `t('key', { name })`, `t('pluralKey', { count })`. */
export function translator<S extends Source>(
  dictionary: Dictionary<S>,
): <K extends keyof S & string>(key: K, ...args: Args<S[K]>) => string {
  return (key, ...args) => translate(dictionary, key, args[0]);
}

const PLAIN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ACCENTED = 'áƀçðéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýžÁƁÇÐÉƑĜĤÎĴĶĻṀÑÖÞǪŔŠŢÛṼŴẊÝŽ';

/**
 * Pseudo-translation of a template: accented letters, 40 % longer (German runs about a third longer than
 * English), framed in `[!! … !!]`. `{name}` placeholders are untouched: their values arrive as is.
 */
export function pseudoText(text: string): string {
  const accented = text
    .split(/(\{\w+\})/)
    .map((part, index) =>
      index % 2 ? part : part.replace(/[A-Za-z]/g, (letter) => ACCENTED[PLAIN.indexOf(letter)] ?? letter),
    )
    .join('');
  return `[!! ${accented}${'~'.repeat(Math.ceil(text.length * 0.4))} !!]`;
}
