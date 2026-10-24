// Obsidian's language for module dates and numbers and for Buba's UI language: `getLanguage()` (since 1.8.7).
// Obsidian formats its own numbers with it and sets `moment.locale` at startup (app.js 1.14.4); changing the
// language restarts the app, so the language is read at render time with no subscription. `obsidian` is
// imported as a namespace, not by name: other test suites load this file with an `obsidian` mock that lacks
// `getLanguage`, and a named import of a missing export fails loading the whole module.
import * as obsidian from 'obsidian';
import { PSEUDO, pickLanguage, setLanguage, type UiLanguage } from '../core/i18n/index.ts';

/**
 * Obsidian's UI language as a tag `Intl` accepts ("ru", "en-GB", "zh-TW"). `undefined` (so `Intl` uses its
 * default) when `getLanguage` is missing (mock, Obsidian before 1.8.7), throws, or returns something that is
 * not a language tag: Obsidian's language setting also accepts a path to a translation file and returns it as
 * is.
 */
export function obsidianLanguage(): string | undefined {
  const { getLanguage } = obsidian as Partial<typeof obsidian>;
  if (typeof getLanguage !== 'function') return undefined;
  try {
    return Intl.getCanonicalLocales(getLanguage())[0];
  } catch {
    return undefined;
  }
}

/** Local storage key for translation debugging: `en-XA` is the pseudo-language; other values are ignored. */
export const DEBUG_LANGUAGE_KEY = 'buba-debug-language';

/**
 * Buba's language from Obsidian's (src/core/i18n): Russian Obsidian gives Russian, any language not in the
 * table gives English. Called once at the start of `onload`, since a language change in Obsidian reloads the
 * window. To debug truncation and untranslated strings, set `buba-debug-language = en-XA` in the window's
 * local storage.
 */
export function applyObsidianLanguage(): UiLanguage {
  let debug: string | null = null;
  try {
    debug = globalThis.localStorage?.getItem(DEBUG_LANGUAGE_KEY) ?? null;
  } catch {
    debug = null;
  }
  const language: UiLanguage = debug === PSEUDO ? PSEUDO : pickLanguage(obsidianLanguage());
  setLanguage(language);
  return language;
}
