// Default hotkeys of Buba commands, in one list. This departs from Obsidian's plugin guideline ("Avoid
// setting a default hotkey for commands"; `Command.hotkeys` in obsidian.d.ts) on purpose: frequent features
// should have a key right away, without setup. To drop one key or all of them, edit only this file: commands
// take their keys from here and nowhere else. Combinations are only Mod+Shift plus one key, none clashing
// with Obsidian 1.14.4, its menus or the OS (checked by a test); commands
// that delete or move files have no keys at all. A key the user assigns overrides this one in Obsidian. No
// `obsidian` import: the key type matches `Hotkey`.
export interface DefaultHotkey {
  readonly modifiers: readonly ['Mod', 'Shift'];
  readonly key: string;
}

/** Command `buba:<id>` → its default hotkeys. Delete a line to drop them. */
export const DEFAULT_HOTKEYS: Readonly<Record<string, readonly DefaultHotkey[]>> = {
  open: [{ modifiers: ['Mod', 'Shift'], key: 'B' }],
  'tile-size-up': [{ modifiers: ['Mod', 'Shift'], key: '=' }],
  'tile-size-down': [{ modifiers: ['Mod', 'Shift'], key: '-' }],
  'reset-type-filter': [{ modifiers: ['Mod', 'Shift'], key: 'X' }],
  'layout-uniform': [{ modifiers: ['Mod', 'Shift'], key: '7' }],
  'layout-justified': [{ modifiers: ['Mod', 'Shift'], key: '8' }],
  'layout-waterfall': [{ modifiers: ['Mod', 'Shift'], key: '9' }],
  'reveal-folder': [{ modifiers: ['Mod', 'Shift'], key: 'E' }],
  'copy-file-path': [{ modifiers: ['Mod', 'Shift'], key: 'C' }],
  'duplicate-file': [{ modifiers: ['Mod', 'Shift'], key: 'D' }],
};

/**
 * Hotkeys of a command for `addCommand`, as a copy so the shared list never leaks; none gives `undefined`.
 */
export function hotkeysOf(id: string): { modifiers: ('Mod' | 'Shift')[]; key: string }[] | undefined {
  if (!Object.hasOwn(DEFAULT_HOTKEYS, id)) return undefined;
  return DEFAULT_HOTKEYS[id]?.map(({ modifiers, key }) => ({ modifiers: [...modifiers], key }));
}
