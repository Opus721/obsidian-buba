// Obsidian's "Automatically update internal links" setting (`alwaysUpdateLinks`) through the public
// `SettingTab` (src/platform/core-settings.ts). Buba changes only this setting and only ever to "on". The
// answer to Buba's prompt is kept in per-vault local storage on this device, like the device id
// (src/platform/device.ts).
import type { App } from 'obsidian';
import { CoreSettings, coreSetting } from '../core-settings.ts';

const SETTING = 'alwaysUpdateLinks';
/** Local storage key; Obsidian prefixes it with the vault id. */
const KEY = 'buba-links-setting';

/** Answer to Buba's prompt: "Enable" or "Don't enable". */
export type LinksSettingAnswer = 'enable' | 'decline';

/** Whether the setting is on; `null` if unreadable (no `getControlValue` before Obsidian 1.13.0). */
export function linksAutoUpdate(app: App): boolean | null {
  const value = coreSetting(app, SETTING);
  return value === undefined ? null : value === true;
}

/** Turns the setting on; returns the value read back after the write. Write errors go to the console. */
export async function enableLinksAutoUpdate(app: App): Promise<boolean> {
  try {
    await new CoreSettings(app).setControlValue(SETTING, true);
  } catch (error) {
    console.error('Buba: Obsidian setting "Automatically update internal links" not turned on', error);
  }
  return linksAutoUpdate(app) === true;
}

/** Whether Buba's prompt was already answered in this vault on this device. */
export function linksSettingAnswered(app: App): boolean {
  const saved: unknown = app.loadLocalStorage(KEY);
  return saved === 'enable' || saved === 'decline';
}

export function saveLinksSettingAnswer(app: App, answer: LinksSettingAnswer): void {
  app.saveLocalStorage(KEY, answer);
}
