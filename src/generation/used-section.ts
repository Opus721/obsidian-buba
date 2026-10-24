// "Used in generations" file panel section (`buba-generation-used`, order 48): the generated files whose
// passport names the one shown file as a reference, newest first, as thumbnails with the same clicks and menu
// as references. Only results that are in the vault; shown only when there is at least one.
import type { Plugin, TAbstractFile } from 'obsidian';
import { mediaOfPath } from '../core/generation/refs.ts';
import { t } from '../core/i18n/dict/generation.ts';
import { USED_SECTION, type PanelSection } from '../core/inspector/events.ts';
import { passportStorage } from '../platform/passports.ts';
import { foldHeading } from './fold.ts';
import { ThumbSet } from './thumbs.ts';

export const USED_SECTION_ID = USED_SECTION;
const FOLD_KEY = 'buba-generation-used-folded';

export function usedSection(plugin: Plugin): PanelSection {
  const { app } = plugin;
  const watchers = new Set<(file: TAbstractFile, oldPath?: string) => void>();
  const touched = (file: TAbstractFile, oldPath?: string): void => {
    for (const watch of [...watchers]) watch(file, oldPath);
  };
  plugin.registerEvent(app.vault.on('create', touched));
  plugin.registerEvent(app.vault.on('delete', touched));
  plugin.registerEvent(app.vault.on('rename', touched));

  return {
    id: USED_SECTION_ID,
    order: 48,
    render(el, paths) {
      const [only] = paths;
      const storage = passportStorage(plugin);
      if (only === undefined || paths.length > 1 || !storage) {
        el.hide();
        return;
      }
      const thumbs = new ThumbSet(plugin);
      let results: string[] = [];
      const draw = (): void => {
        thumbs.clear();
        el.empty();
        results = storage.usedIn(only);
        if (!results.length) {
          el.hide();
          return;
        }
        el.show();
        if (foldHeading(app, el, FOLD_KEY, t('usedTitle'), String(results.length), draw)) return;
        el.createDiv({ cls: 'buba-gen-label' }).createSpan({
          cls: 'buba-gen-label-text',
          text: t('usedCount', { count: results.length }),
        });
        const grid = el.createDiv({ cls: 'buba-gen-thumbs' });
        for (const path of results) {
          const file = app.vault.getFileByPath(path);
          if (!file) continue;
          const item = thumbs.add({ file, path, name: file.name, media: mediaOfPath(path) });
          thumbs.thumb(grid, item, file.name, null);
        }
      };
      draw();
      const off = storage.onChange((changed) => {
        if (changed.includes(only)) draw();
      });
      // A result moved to the trash or brought back changes the list; storage does not report it for us.
      const watch = (file: TAbstractFile, oldPath?: string): void => {
        if (results.includes(file.path) || (oldPath !== undefined && results.includes(oldPath))) draw();
        else if (file.path !== only && storage.passport(file.path)?.refs?.some((ref) => ref.path === only))
          draw();
      };
      watchers.add(watch);
      return () => {
        off();
        watchers.delete(watch);
        thumbs.clear();
      };
    },
  };
}
