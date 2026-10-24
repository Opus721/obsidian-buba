// Generation module: the generation passport of a file. The file panel sections "Generation" and "Used in
// generations" come in through the `buba:inspector-sections` workspace event; agents write passports with
// `buba:passport` (src/cli) or through the inbox. A reference deleted outside Buba gets a notice. Uses only `core` and `platform`.
import type { Events, Plugin } from 'obsidian';
import { INSPECTOR_SECTIONS, INSPECTOR_SECTIONS_ASK, type PanelSection } from '../core/inspector/events.ts';
import { registerDeletedOutside } from './deleted-outside.ts';
import { registerPassportInbox } from './inbox.ts';
import { generationSection } from './section.ts';
import { usedSection } from './used-section.ts';
import './generation.css';

export function registerGenerationModule(plugin: Plugin): void {
  registerPassportInbox(plugin);
  registerDeletedOutside(plugin);
  const sections = [generationSection(plugin), usedSection(plugin)];
  // Obsidian's types do not know our workspace events, so the workspace is used as `Events`.
  const workspace = plugin.app.workspace as Events;
  const receive = (add: unknown): void => {
    if (typeof add !== 'function') return;
    for (const section of sections) (add as (section: PanelSection) => () => void)(section);
  };
  plugin.registerEvent(workspace.on(INSPECTOR_SECTIONS, receive));
  // Enabled or updated with the layout ready, the panel asked before this module listened.
  workspace.trigger(INSPECTOR_SECTIONS_ASK, receive);
}
