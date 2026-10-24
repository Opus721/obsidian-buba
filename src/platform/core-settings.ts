// Obsidian settings (`.obsidian/app.json`) through the public `SettingTab`: since 1.13.0 `getControlValue` /
// `setControlValue` read and write them the same way Obsidian's own tabs do.
import { SettingTab, type App } from 'obsidian';

/** Invisible tab: never added to Settings, exists only for `getControlValue` / `setControlValue`. */
export class CoreSettings extends SettingTab {
  constructor(app: App) {
    super();
    this.app = app;
  }
}

/**
 * Value of an Obsidian setting by its `app.json` key; Obsidian's default if the file lacks the key.
 * `undefined` if unreadable: `SettingTab` has no `getControlValue` before Obsidian 1.13.0. Read on every
 * call, never cached.
 */
export function coreSetting(app: App, key: string): unknown {
  const tab = new CoreSettings(app);
  if (typeof tab.getControlValue !== 'function') return undefined;
  return tab.getControlValue(key);
}

/** Turns a setting on after an explicit click; the result is a fresh read of the same setting. */
export async function enableCoreSetting(app: App, key: string): Promise<boolean> {
  return setCoreSetting(app, key, true);
}

/** Writes an explicit choice; does nothing on old Obsidian without the public API. */
export async function setCoreSetting(app: App, key: string, value: boolean): Promise<boolean> {
  const tab = new CoreSettings(app);
  if (typeof tab.getControlValue !== 'function' || typeof tab.setControlValue !== 'function') return false;
  try {
    await tab.setControlValue(key, value);
  } catch (error) {
    console.error(`Buba: Obsidian setting "${key}" not saved`, error);
    return false;
  }
  return coreSetting(app, key) === value;
}
