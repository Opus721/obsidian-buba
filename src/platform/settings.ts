// Buba settings for modules live in `Plugin.settings` (obsidian.d.ts 1.13: "Assign loaded data here in
// onload"), set from `data.json` by src/main.ts. Modules read the value at the moment of use, so a change
// applies at once. `obsidian` is a type-only import: other test suites load this file via
// src/assets/viewer/open.ts and src/assets/tags/selection.ts.
import type { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, normalizeSettings, type BubaSettings } from '../core/settings/settings.ts';

/** Plugin settings, or the defaults when there are none (mock, Obsidian has not loaded them yet). */
export function settingsOf(plugin: Plugin): Readonly<BubaSettings> {
  return (plugin.settings as BubaSettings | undefined) ?? DEFAULT_SETTINGS;
}

/**
 * Reads `data.json` into `plugin.settings`: on load and when it changed externally (Sync, manual edit:
 * `onExternalSettingsChange`). A missing, broken or unreadable file gives the defaults; the file is not
 * written.
 */
export async function loadSettings(plugin: Plugin): Promise<BubaSettings> {
  let raw: unknown = null;
  try {
    raw = await plugin.loadData();
  } catch (error) {
    console.error('Buba: data.json not read — using default settings', error);
  }
  const settings = normalizeSettings(raw);
  plugin.settings = settings;
  settingsChanged(plugin);
  return settings;
}

type SettingsListener = (settings: Readonly<BubaSettings>) => void;
const listeners = new WeakMap<Plugin, Set<SettingsListener>>();

/**
 * Notifies about settings changes at once, for views that do not read them at the moment of use (file panel
 * dates): a write from the settings page or a fresh read of `data.json`. The returned function unsubscribes.
 */
export function onSettingsChange(plugin: Plugin, listener: SettingsListener): () => void {
  let set = listeners.get(plugin);
  if (!set) listeners.set(plugin, (set = new Set()));
  set.add(listener);
  return () => set.delete(listener);
}

/**
 * Settings changed: the Obsidian 1.13+ settings page writes them itself (`setControlValue`) and calls this
 * after.
 */
export function settingsChanged(plugin: Plugin): void {
  const settings = settingsOf(plugin);
  for (const listener of listeners.get(plugin) ?? []) listener(settings);
}

/** Updates and writes the whole `data.json`, keeping unknown keys from other builds. */
export async function saveSettings(plugin: Plugin, patch: Partial<BubaSettings>): Promise<void> {
  const settings = normalizeSettings({ ...settingsOf(plugin), ...patch });
  plugin.settings = settings;
  // The UI follows `plugin.settings` at once, like hotkeys and menus: a failed write does not roll back
  // memory.
  settingsChanged(plugin);
  await plugin.saveData(settings);
}
