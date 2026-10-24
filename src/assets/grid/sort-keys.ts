// Wires the toolbar above the grid. Built-in sorts go into the registry in the order they appear in the
// toolbar list; the comparison comes from the core, the grid adds direction and tie order. "By rating" comes
// from the tags module, "By type" is `registerTypeSort` after it. The toolbar also learns the vault name
// here: it has no Obsidian access.
import type { Plugin } from 'obsidian';
import { t } from '../../core/i18n/dict/grid.ts';
import { compareByType } from '../../core/sort/by-type.ts';
import { compareFiles, type SortKey } from '../../core/sort/sort-files.ts';
import type { BubaAssets } from '../api.ts';
import { connectToolbar } from './toolbar.ts';

const BUILT_IN = [
  ['created', 'sortCreated'],
  ['name', 'sortName'],
  ['modified', 'sortModified'],
  ['size', 'sortSize'],
] as const satisfies readonly (readonly [SortKey, string])[];

export function registerSortKeys(plugin: Plugin, assets: BubaAssets): void {
  for (const [id, title] of BUILT_IN) assets.registerSortKey(id, t(title), compareFiles(id));
  connectToolbar(assets, () => plugin.app.vault.getName());
}

/** "By type", listed after "By rating": src/assets/index.ts calls this after the tags module. */
export function registerTypeSort(assets: BubaAssets): void {
  assets.registerSortKey('type', t('sortType'), compareByType);
}
