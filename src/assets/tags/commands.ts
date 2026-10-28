// Tag commands: "Create tag…" opens the same dialog as "+ New tag", the "All tags" menu item (tag-menu.ts) and
// the "New tag" button of the tree's header; "Open untagged files" opens the "Untagged" source in the grid, like clicking its tree row.
// Without storage (journals failed to load) or without the "Untagged" source the commands are unavailable.
// They are registered by the src/assets/commands.ts hub, not by the tags entry point (tags/index.ts).
import type { Plugin } from 'obsidian';
import { t } from '../../core/i18n/dict/tags.ts';
import type { TagStorage } from '../../core/storage/types.ts';
import type { BubaAssets } from '../api.ts';
import { openNewTag } from './tag-menu.ts';

const UNTAGGED = { kind: 'untagged' } as const;

export function registerTagCommands(
  plugin: Plugin,
  assets: BubaAssets,
  storage: () => TagStorage | undefined,
): void {
  // The same dialog from the tree's header, next to "New folder" (word of the owner 27.10 22:22).
  assets.registerTreeButton({
    id: 'new-tag',
    icon: 'lucide-tag',
    title: t('newTag'),
    order: 10,
    run: () => {
      const current = storage();
      if (current) openNewTag(plugin.app, current, null);
    },
  });
  plugin.addCommand({
    id: 'new-tag',
    name: t('commandNewTag'),
    icon: 'plus',
    checkCallback: (checking) => {
      const current = storage();
      if (!current) return false;
      if (!checking) openNewTag(plugin.app, current, null);
      return true;
    },
  });
  plugin.addCommand({
    id: 'open-untagged',
    name: t('commandOpenUntagged'),
    icon: 'tag',
    checkCallback: (checking) => {
      if (!assets.gridSource(UNTAGGED.kind)) return false;
      if (!checking) void assets.openGrid(UNTAGGED);
      return true;
    },
  });
}
