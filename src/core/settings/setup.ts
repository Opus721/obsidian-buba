// What the "What Obsidian needs" window shows, without the `obsidian` import. Each item shows until it has
// been shown on this device (`shown`). An Obsidian setting shows while it is off, and the links one also only
// until the pre-move dialog is answered (src/assets/actions/links-setting.ts); `null` means unreadable
// (Obsidian before 1.13.0) and the item is skipped. The Sync note always shows until first seen: Sync is set
// up per device and Buba cannot see it.

export type SetupItem = 'alwaysUpdateLinks' | 'showUnsupportedFiles' | 'sync';
export const SETUP_ITEMS: readonly SetupItem[] = ['alwaysUpdateLinks', 'showUnsupportedFiles', 'sync'];

export interface SetupState {
  /** Items shown on this device, including unknown ids from other builds. */
  readonly shown: readonly string[];
  /** "Always update internal links"; `null` means unreadable. */
  readonly links: boolean | null;
  /** The pre-move dialog was already answered with "Turn on" or "Don't turn on". */
  readonly linksAnswered: boolean;
  /** "Detect all file extensions"; `null` means unreadable. */
  readonly unsupported: boolean | null;
}

/** Window items in order; empty means no window. */
export function setupPlan(state: SetupState): SetupItem[] {
  const wanted: Record<SetupItem, boolean> = {
    alwaysUpdateLinks: state.links === false && !state.linksAnswered,
    showUnsupportedFiles: state.unsupported === false,
    sync: true,
  };
  return SETUP_ITEMS.filter((item) => wanted[item] && !state.shown.includes(item));
}

/** Items the "Turn on" button enables itself; Buba cannot enable the Sync note. */
export function enabling(items: readonly SetupItem[]): Exclude<SetupItem, 'sync'>[] {
  return items.filter((item): item is Exclude<SetupItem, 'sync'> => item !== 'sync');
}

/** Value from local storage to the list of shown items; any other shape means nothing shown. */
export function readShown(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
}
