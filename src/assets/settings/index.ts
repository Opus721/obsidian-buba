// Buba settings page and the "What Obsidian needs" setup window. A plugin gets one settings page: a second
// `addSettingTab` would add a second "Buba" tab. Values live in `plugin.settings`, loaded from `data.json`
// (src/main.ts); modules read them through src/platform/settings.ts. Imports only src/core and src/platform.
import type { Plugin } from 'obsidian';
import { registerSetupWindow } from './setup-window.ts';
import { BubaSettingTab } from './tab.ts';

export function registerSettings(plugin: Plugin): void {
  plugin.addSettingTab(new BubaSettingTab(plugin.app, plugin));
  registerSetupWindow(plugin);
}
