// Folder icon of the Buba tree: the list of the "Folder icon…" window and the icon of a folder row. The set
// is the Lucide icons built into Obsidian (`getIconIds()`, names prefixed `lucide-`); plugin icons and
// Obsidian's own are not offered. The default is the constant `lucide-folder-open`, grey, because that is how
// Obsidian draws its own `folder` (alias table in app.js 1.13.7 and 1.14.4); it has no separate row in the
// list, since "Folder (default)" writes `null`. A tree row shows the default open only while the folder is
// expanded; collapsed, or without subfolders, it is the closed `lucide-folder`, so the icon itself tells the
// state, as the arrow does (`treeFolderIcon`). A folder's own icon has no closed form and stays as it is.
// Names are English, Obsidian has no translations for them, so
// search is in English. No `obsidian` import.
import { t } from '../i18n/dict/tree.ts';
import { isIconId } from './icon-id.ts';

/** Icon for folders without their own icon or with one this Obsidian lacks, and for the default row. */
export const DEFAULT_FOLDER_ICON = 'lucide-folder-open';

/** The default icon of a collapsed tree row or one without subfolders. */
export const CLOSED_FOLDER_ICON = 'lucide-folder';

/** Icon window row: a Lucide icon or `null` for the default; the window searches and shows `text`. */
export interface IconChoice {
  readonly id: string | null;
  readonly text: string;
}

const PREFIX = 'lucide-';

/** Row text of an icon: the name without `lucide-`, hyphens as spaces: "folder open". */
export function iconText(id: string): string {
  return id.slice(PREFIX.length).replaceAll('-', ' ');
}

/**
 * The icon window list from `getIconIds()`: "Folder (default)" first, then
 * icons with `folder` in the name, then the rest, each part alphabetical.
 * Only Lucide in the `getIconIds()` form; no default icon and no duplicates.
 */
export function iconChoices(ids: Iterable<string>): IconChoice[] {
  const lucide = [...new Set(ids)].filter((id) => isIconId(id) && id !== DEFAULT_FOLDER_ICON).sort();
  const folders = lucide.filter((id) => id.includes('folder'));
  const rest = lucide.filter((id) => !id.includes('folder'));
  return [
    { id: null, text: t('iconDefault') },
    ...[...folders, ...rest].map((id) => ({ id, text: iconText(id) })),
  ];
}

/**
 * What to draw for a folder: its own icon if Obsidian knows it (`known` is
 * `getIcon(id) !== null`), else the default. Obsidian 1.12.x has fewer Lucide icons
 * than 1.13 and 1.14, so an icon picked on a newer Obsidian shows as a folder there.
 */
export function folderIcon(icon: string | null, known: (id: string) => boolean): string {
  return isIconId(icon) && known(icon) ? icon : DEFAULT_FOLDER_ICON;
}

/** A tree row's icon: `folderIcon`, with the default closed unless the row is expanded. */
export function treeFolderIcon(icon: string | null, known: (id: string) => boolean, open: boolean): string {
  const id = folderIcon(icon, known);
  return id === DEFAULT_FOLDER_ICON && !open ? CLOSED_FOLDER_ICON : id;
}
