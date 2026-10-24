// Tags and rating for selected grid tiles. Keys T and 1–5 live on the grid view's `scope`: while the grid
// body has focus Obsidian routes them to the grid, while in a note they type letters. The same actions exist
// as commands with no default hotkey: Obsidian's guidelines say not to claim hotkeys, and users assign their
// own in Hotkeys settings. The "Keys in grid" toggle on Buba's settings page (src/assets/settings/tab.ts)
// turns the keys off. The file panel shows the selection itself (src/assets/inspector/follow.ts).
import { ItemView, Notice, type Plugin } from 'obsidian';
import { t } from '../../core/i18n/dict/tags.ts';
import { inDataDir, type BubaStorage, type Rating } from '../../core/storage/types.ts';
import { isTypingTarget, keyAction, type KeyAction } from '../../core/tags/keys.ts';
import { settingsOf } from '../../platform/settings.ts';
import type { BubaAssets, BubaGridView } from '../api.ts';
import { openTagPicker } from './picker.ts';

const RATINGS = [1, 2, 3, 4, 5] as const;

/**
 * Commands with no default hotkey; the Obsidian id is `buba:<id>`. Names are built at registration, after the
 * language is chosen, not at import.
 */
const commands = (): { id: string; name: string; action: KeyAction }[] => [
  { id: 'tag-selected', name: t('commandTagSelected'), action: { kind: 'tag' } },
  ...RATINGS.map((rating) => ({
    id: `rate-${rating}`,
    name: t('commandRate', { rating }),
    action: { kind: 'rate', rating } satisfies KeyAction,
  })),
];

export function registerSelectionActions(plugin: Plugin, assets: BubaAssets): void {
  const { vault, workspace } = plugin.app;

  // A selection may include folders: tags and rating go to files only, as with "Add tag…" in the file menu;
  // journals in Buba data folders (`__buba-data/`, the old `Buba/`) are left out.
  const filesOf = (paths: readonly string[]): string[] =>
    paths.filter((path) => !inDataDir(path) && vault.getFileByPath(path) !== null);

  const run = (action: KeyAction, storage: BubaStorage, paths: string[]): void => {
    if (action.kind === 'tag') openTagPicker(plugin.app, storage, paths);
    else void rate(storage, paths, action.rating);
  };

  // Keys go on the `scope` of every grid view, including ones opened later, once per view. Cleanup is
  // registered on the view, not the plugin: a plugin-level registration would keep every closed view alive
  // until unload.
  const wired = new WeakSet<BubaGridView>();
  const install = (): void => {
    for (const view of assets.gridViews()) {
      const { scope } = view;
      if (!(view instanceof ItemView) || wired.has(view) || !scope) continue;
      wired.add(view);
      // Modifiers `null`, not `[]`: Obsidian stores a `[]` handler as the string `''`, and `Scope.handleKey`
      // stops after it, so a later Space handler of the viewer never ran. `keyAction` filters out
      // combinations. When off on Buba's settings page the handler returns `undefined`, so the key goes on to
      // Obsidian's hotkeys.
      const handler = scope.register(null, null, (evt) => {
        const action = keyAction(evt.code, evt.key, evt);
        if (!action || !settingsOf(plugin).gridKeys || isTypingTarget(evt.target as Element | null))
          return undefined;
        const storage = storageOf(plugin);
        const paths = filesOf(view.selectedPaths?.() ?? []);
        if (!storage || !paths.length) return undefined;
        // A held key repeats: swallow the repeats without acting again.
        if (!evt.repeat) run(action, storage, paths);
        return false;
      });
      view.register(() => scope.unregister(handler));
    }
  };
  workspace.onLayoutReady(install);
  plugin.registerEvent(workspace.on('layout-change', install));

  // Commands are available while a grid with a selection is active and storage is open.
  for (const { id, name, action } of commands()) {
    plugin.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        const active: unknown = workspace.getActiveViewOfType(ItemView);
        const view = assets.gridViews().find((each) => (each as unknown) === active);
        const storage = storageOf(plugin);
        const paths = filesOf(view?.selectedPaths?.() ?? []);
        if (!storage || !paths.length) return false;
        if (!checking) run(action, storage, paths);
        return true;
      },
    });
  }
}

/** Storage is the plugin's `storage` field; without it keys and commands do nothing. */
function storageOf(plugin: Plugin): BubaStorage | undefined {
  return (plugin as Plugin & { storage?: BubaStorage }).storage;
}

/** Sets the rating on all selected files in one storage write. */
async function rate(storage: BubaStorage, paths: string[], rating: Exclude<Rating, 0>): Promise<void> {
  try {
    await storage.setRating(paths, rating);
  } catch (error) {
    console.error('Buba: rating not set', error);
    new Notice(t('rateFailed'));
  }
}
