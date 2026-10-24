// Obsidian commands for Buba features, registered by one call at the end of `registerAssets`: the "by rating"
// sort key comes from the tags module (`registerTags`), and registering earlier would give sort commands
// without it. Each module provides its commands from its own `commands.ts`; default hotkeys come only from
// src/core/settings/hotkeys.ts. Ids are `buba:<id>`, names start with a verb, like Obsidian's own commands.
import type { Plugin } from 'obsidian';
import type { TagStorage } from '../core/storage/types.ts';
import { registerFileCommands } from './actions/commands.ts';
import type { BubaAssets } from './api.ts';
import { registerGridCommands } from './grid/commands.ts';
import { registerInspectorCommands } from './inspector/commands.ts';
import { registerTagCommands } from './tags/commands.ts';
import { registerTreeCommands } from './tree/commands.ts';

export function registerCommands(plugin: Plugin, assets: BubaAssets): void {
  registerGridCommands(plugin, assets);
  registerTreeCommands(plugin, assets);
  registerTagCommands(plugin, assets, () => (plugin as Plugin & { storage?: TagStorage }).storage);
  registerInspectorCommands(plugin, assets);
  registerFileCommands(plugin, assets);
}
