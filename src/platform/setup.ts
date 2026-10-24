// Obsidian settings Buba offers to turn on (the "What Obsidian needs" dialog and Settings → Buba), and which
// items the dialog has already shown on this device. Goes through the public `SettingTab`
// (src/platform/core-settings.ts), only ever writes "on", and only after the user clicks "Enable". Shown
// items live in per-vault local storage.
import type { App } from 'obsidian';
import { readShown, type SetupItem } from '../core/settings/setup.ts';
import { coreSetting, enableCoreSetting } from './core-settings.ts';

/** Local storage key; Obsidian prefixes it with the vault id. */
const SHOWN = 'buba-setup-shown';

/** Obsidian settings Buba turns on, from "Files and links". */
export type CoreFlag = 'alwaysUpdateLinks' | 'showUnsupportedFiles';

/** Whether an Obsidian setting is on; `null` if unreadable (no `getControlValue` before Obsidian 1.13). */
export function coreFlag(app: App, key: CoreFlag): boolean | null {
  const value = coreSetting(app, key);
  return value === undefined ? null : value === true;
}

/** Turns an Obsidian setting on; returns the value read back after the write. Errors go to the console. */
export async function enableCoreFlag(app: App, key: CoreFlag): Promise<boolean> {
  return enableCoreSetting(app, key);
}

/** Items the dialog has already shown on this device. */
export function shownItems(app: App): string[] {
  return readShown(app.loadLocalStorage(SHOWN));
}

/** Adds items to the shown ones; unknown ids from other builds are kept. */
export function markShown(app: App, items: readonly SetupItem[]): void {
  app.saveLocalStorage(SHOWN, [...new Set([...shownItems(app), ...items])]);
}
