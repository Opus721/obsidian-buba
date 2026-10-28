// Obsidian commands for the toolbar above the grid and the "View" menu: ids are `buba:<id>`, names start with
// a verb, like Obsidian's commands. Commands work while a grid is active (`getActiveViewOfType`) and use the
// same paths as the buttons: state from `getState`, changes through `setGridState`, and the type filter,
// place view and source title from this view's toolbar (`toolbarOf`). A command that would change nothing
// right now is unavailable: it is hidden from the palette and its hotkey passes through, like Obsidian's
// unavailable commands. Hotkeys come only from src/core/settings/hotkeys.ts. This also connects the standard
// tile size to the toolbar and installs the wheel (wheel.ts).
import type { IconName, Plugin } from 'obsidian';
import { stepTileSize } from '../../core/layout/tile-size.ts';
import { normalizeGridViewState, type GridViewState } from '../../core/layout/view-state.ts';
import { t } from '../../core/i18n/dict/grid.ts';
import { hotkeysOf } from '../../core/settings/hotkeys.ts';
import type { BubaAssets } from '../api.ts';
import { crumbs } from './navigation.ts';
import { standardTileSize } from './place-views.ts';
import { selectAllTiles } from './selection.ts';
import { connectStandardSize, SIZE_RESET_ICON, toolbarOf, type ToolbarNow } from './toolbar.ts';
import { openTypeWindow } from './type-filter.ts';
import { GridView } from './view.ts';
import { registerTileWheel } from './wheel.ts';

/** The active grid, its state and toolbar; `null` toolbar if it is not there yet. */
interface Grid {
  readonly view: GridView;
  readonly state: GridViewState;
  readonly bar: ToolbarNow | null;
}

interface GridCommand {
  id: string;
  name: string;
  icon?: IconName;
  repeatable?: boolean;
  /** Whether it applies now: if not, the command is hidden from the palette and the hotkey is not ours. */
  can: (grid: Grid) => boolean;
  run: (grid: Grid) => void;
}

const LAYOUTS = [
  ['uniform', 'commandLayoutUniform'],
  ['justified', 'commandLayoutJustified'],
  ['waterfall', 'commandLayoutWaterfall'],
] as const;
const FITS = [
  ['contain', 'commandFitContain'],
  ['cover', 'commandFitCover'],
] as const;
const DIRS = [
  ['asc', 'commandSortAsc'],
  ['desc', 'commandSortDesc'],
] as const;

/**
 * Sort command names: a full phrase per registry key; a key the dictionary does not know gets a generic
 * phrase with its title.
 */
const SORT_COMMANDS: Readonly<Record<string, Parameters<typeof t>[0]>> = {
  created: 'commandSortCreated',
  name: 'commandSortName',
  modified: 'commandSortModified',
  size: 'commandSortSize',
  type: 'commandSortType',
  rating: 'commandSortRating',
};

/** "By date added" → "Sort by date added"; an unknown key gives "Sort: <title>". */
const sortName = (id: string, title: string): string => {
  const key = Object.hasOwn(SORT_COMMANDS, id) ? SORT_COMMANDS[id] : undefined;
  return key ? t(key) : t('commandSortOther', { title });
};

/**
 * The folder above the open one, the path crumb before its name; the root, "All files" and module sources
 * have none.
 */
function parentFolder({ state, bar }: Grid): string | null {
  if (state.folder === null || (bar ? bar.ctx.sourceTitle() !== null : state.source !== undefined))
    return null;
  return crumbs(state.folder, '').at(-2)?.folder ?? null;
}

/**
 * Grid commands; the sort keys are those in the registry now: `registerCommands` runs after every
 * `register…`.
 */
export function gridCommands(plugin: Plugin, assets: BubaAssets): GridCommand[] {
  const standard = () => standardTileSize(plugin, assets);
  const size = (steps: number) => (grid: Grid) => stepTileSize(grid.state.size, steps);
  const set = (grid: Grid, patch: Partial<GridViewState>) => grid.view.setGridState(patch);
  return [
    {
      id: 'tile-size-up',
      name: t('commandTileSizeUp'),
      icon: 'zoom-in',
      repeatable: true,
      can: (grid) => size(1)(grid) !== grid.state.size,
      run: (grid) => set(grid, { size: size(1)(grid) }),
    },
    {
      id: 'tile-size-down',
      name: t('commandTileSizeDown'),
      icon: 'zoom-out',
      repeatable: true,
      can: (grid) => size(-1)(grid) !== grid.state.size,
      run: (grid) => set(grid, { size: size(-1)(grid) }),
    },
    {
      id: 'tile-size-reset',
      name: t('commandTileSizeReset'),
      icon: SIZE_RESET_ICON,
      can: (grid) => grid.state.size !== standard(),
      run: (grid) => set(grid, { size: standard() }),
    },
    {
      id: 'reset-type-filter',
      name: t('commandResetTypeFilter'),
      icon: 'filter-x',
      can: ({ bar }) => (bar?.ctx.types.selected.size ?? 0) > 0,
      run: ({ bar }) => bar?.ctx.types.set(new Set()),
    },
    {
      id: 'type-filter',
      name: t('commandChooseTypes'),
      icon: 'filter',
      can: ({ bar }) => bar !== null,
      run: ({ bar }) => {
        if (bar) openTypeWindow(bar.ctx.app, bar.ctx.types);
      },
    },
    ...LAYOUTS.map(([layout, name]): GridCommand => ({
      id: `layout-${layout}`,
      name: t(name),
      can: (grid) => grid.state.layout !== layout,
      run: (grid) => set(grid, { layout }),
    })),
    ...FITS.map(([fit, name]): GridCommand => ({
      id: `fit-${fit}`,
      name: t(name),
      can: (grid) => grid.state.layout === 'uniform' && grid.state.fit !== fit,
      run: (grid) => set(grid, { fit }),
    })),
    {
      id: 'toggle-file-names',
      name: t('commandToggleNames'),
      can: () => true,
      run: (grid) => set(grid, { showNames: !grid.state.showNames }),
    },
    {
      id: 'toggle-subfolders',
      name: t('commandToggleSubfolders'),
      // As in the "View" menu: only for a folder, not for "All files" or a module source.
      can: ({ state, bar }) =>
        state.folder !== null && (bar ? bar.ctx.sourceTitle() === null : !state.source),
      run: (grid) => set(grid, { deep: !grid.state.deep }),
    },
    ...assets.sortKeys().map((key): GridCommand => ({
      id: `sort-${key.id}`,
      name: sortName(key.id, key.title),
      // A key removed from the registry (module disabled) makes the command unavailable, as its menu item is
      // gone.
      can: (grid) => grid.state.sort !== key.id && assets.sortKeys().some((each) => each.id === key.id),
      run: (grid) => set(grid, { sort: key.id }),
    })),
    ...DIRS.map(([dir, name]): GridCommand => ({
      id: `sort-${dir}`,
      name: t(name),
      can: (grid) => grid.state.dir !== dir,
      run: (grid) => set(grid, { dir }),
    })),
    {
      id: 'look-reset',
      name: t('lookReset'),
      can: ({ bar }) => bar?.ctx.look?.own === true,
      run: ({ bar }) => bar?.ctx.look?.reset(),
    },
    {
      id: 'look-make-common',
      name: t('lookMakeDefault'),
      can: ({ bar }) => bar?.ctx.look?.own === true,
      run: ({ bar }) => bar?.ctx.look?.makeCommon(),
    },
    {
      id: 'select-all',
      name: t('commandSelectAll'),
      can: (grid) => grid.view.pathsInOrder().length > 0,
      run: (grid) => selectAllTiles(grid.view),
    },
    {
      id: 'open-parent-folder',
      name: t('commandOpenParent'),
      icon: 'arrow-up',
      can: (grid) => parentFolder(grid) !== null,
      run: (grid) => {
        const folder = parentFolder(grid);
        if (folder !== null) set(grid, { folder });
      },
    },
  ];
}

export function registerGridCommands(plugin: Plugin, assets: BubaAssets): void {
  connectStandardSize(assets, () => standardTileSize(plugin, assets));
  registerTileWheel(plugin, assets);
  const active = (): Grid | null => {
    const view = plugin.app.workspace.getActiveViewOfType(GridView);
    if (!view) return null;
    return { view, state: normalizeGridViewState(view.getState()), bar: toolbarOf(view.contentEl) };
  };
  for (const { id, name, icon, repeatable, can, run } of gridCommands(plugin, assets)) {
    const hotkeys = hotkeysOf(id);
    plugin.addCommand({
      id,
      name,
      ...(icon ? { icon } : {}),
      ...(repeatable ? { repeatable } : {}),
      ...(hotkeys ? { hotkeys } : {}),
      checkCallback: (checking) => {
        const grid = active();
        if (!grid || !can(grid)) return false;
        if (!checking) run(grid);
        return true;
      },
    });
  }
}
