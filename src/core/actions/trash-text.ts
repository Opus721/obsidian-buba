// Line of the delete dialogs about where files go, per Obsidian's "Files and links >
// Deleted files" setting (`trashOption`), in the same words as Obsidian's own single-file delete dialog, in
// plural or for one file. Core rule, no `obsidian` import; src/platform/core-settings.ts reads the setting, the dialog is in
// src/assets/actions/menu-items.ts.
import { t } from '../i18n/dict/actions.ts';

/** Dialog line and a warning flag: "delete permanently" gets an orange paragraph, as in Obsidian's dialog. */
export type TrashLine = { text: string; warning: boolean };

/**
 * Line for a `trashOption` value: `system`, `local`, `none`. Anything else, including `undefined` (setting
 * not readable, Obsidian before 1.13.0), gets the generic line: we do not guess where the files go. `one`
 * words it for a single file, as Obsidian's own dialog does.
 */
export function trashLine(option: unknown, one = false): TrashLine {
  if (option === 'system') return { text: t(one ? 'trashSystemOne' : 'trashSystem'), warning: false };
  if (option === 'local')
    return { text: t(one ? 'trashLocalOne' : 'trashLocal', { folder: '.trash' }), warning: false };
  if (option === 'none') return { text: t(one ? 'trashNoneOne' : 'trashNone'), warning: true };
  return { text: t(one ? 'trashUnknownOne' : 'trashUnknown'), warning: false };
}
