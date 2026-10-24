import { Notice, Plugin } from 'obsidian';
import { registerAssets } from './assets/index.ts';
import { registerCanvasModule } from './canvas/index.ts';
import { registerCliModule } from './cli/index.ts';
import { registerGenerationModule } from './generation/index.ts';
import { DEFAULT_SETTINGS, type BubaSettings } from './core/settings/settings.ts';
import type { BubaStorage } from './core/storage/types.ts';
import { startErrorLog } from './platform/error-log.ts';
import { applyObsidianLanguage } from './platform/locale.ts';
import { loadSettings } from './platform/settings.ts';
import { openStorage } from './platform/storage/index.ts';
import { announceStyleSettings } from './platform/style-settings.ts';
import { applyTreeLook, clearTreeLook } from './platform/tree-look.ts';

declare const __BUBA_COMMIT__: string;

/** Build number: the commit the plugin was built from (`+dirty` means uncommitted changes in src). */
export const BUILD_COMMIT: string = __BUBA_COMMIT__;

export default class BubaPlugin extends Plugin {
  /** Storage for tags, ratings and comments for the tags UI; undefined if the journals failed to load. */
  storage?: BubaStorage;
  /** Buba settings from `data.json` (Settings → Buba); modules read them through src/platform/settings.ts. */
  override settings: BubaSettings = { ...DEFAULT_SETTINGS };

  override async onload(): Promise<void> {
    startErrorLog(this, BUILD_COMMIT);
    // Language before modules: they translate labels while registering commands and rendering.
    applyObsidianLanguage();
    // Settings before modules: grid hotkeys read them on the first key press. Loading never writes data.json.
    await loadSettings(this);
    // Tree look and "Buba" menu labels are body classes from the Appearance settings; unload removes them.
    applyTreeLook(this.settings);
    this.register(() => clearTreeLook());
    // Storage before modules: the grid sorted by rating subscribes to it at registration. Obsidian waits for
    // `onload` before layout; a storage failure does not stop the modules.
    try {
      this.storage = await openStorage(this, (text) => new Notice(text));
    } catch (error) {
      console.error("Buba: storage didn't open — tags, ratings and comments are unavailable", error);
    }
    registerAssets(this);
    registerCanvasModule(this);
    registerCliModule(this);
    registerGenerationModule(this);
    // Buba's section in Style Settings: its block is in styles.css, the plugin rereads styles on this event.
    announceStyleSettings(this.app);
    console.debug(`Buba ${this.manifest.version} (${BUILD_COMMIT.slice(0, 12)}) loaded`);
  }

  /** data.json changed outside Obsidian (Sync or another program); Obsidian refreshes the settings tab. */
  override async onExternalSettingsChange(): Promise<void> {
    applyTreeLook(await loadSettings(this));
  }
}
