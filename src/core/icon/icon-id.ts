// Folder icon of the Buba tree: a Lucide name from Obsidian's set as `getIconIds()`
// returns it, `lucide-<name>` with lowercase Latin letters and digits joined by single
// hyphens. The set lives in Obsidian, the pattern checks only the form: the value comes
// from the journal (another device, a manual edit) and goes into `setIcon`, so exactly
// this form is accepted, with no markup and no other icon sets. No `obsidian` import.

const ICON_ID = /^lucide-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A Lucide icon name in Obsidian's `getIconIds()` form; plugin icons and Obsidian's own are not. */
export function isIconId(value: unknown): value is string {
  return typeof value === 'string' && ICON_ID.test(value);
}
