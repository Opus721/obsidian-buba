// Buba's section in the Style Settings plugin: the `@settings` block and its rules are in
// style-settings.css. Style Settings reads the loaded styles on its own start and again on the workspace event
// `parse-style-settings`; a plugin enabled after it (or reloaded) has to fire the event, as the plugin's README
// asks. Without Style Settings nobody listens and nothing happens.
import type { App } from 'obsidian';
import './style-settings.css';

export const STYLE_SETTINGS_EVENT = 'parse-style-settings';

/** Asks Style Settings, if installed, to read Buba's styles again. */
export function announceStyleSettings(app: App): void {
  app.workspace.trigger(STYLE_SETTINGS_EVENT);
}
