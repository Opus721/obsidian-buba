// Recent custom colors of the color dialog are device state, not vault data, so they live in local storage,
// like recent tags and the device id. Obsidian prefixes the key with the vault id. Stored values are
// validated before they are shown (src/core/color/palette.ts).
import type { App } from 'obsidian';
import { pushRecentColor, readRecentColors } from '../../core/color/palette.ts';
import type { ColorValue, HexColor } from '../../core/color/value.ts';

const KEY = 'buba-recent-colors';

export function recentColors(app: App): HexColor[] {
  return readRecentColors(app.loadLocalStorage(KEY));
}

/** Puts the chosen custom color first in the recents; presets and "no color" are not remembered. */
export function rememberColor(app: App, value: ColorValue | null): void {
  const recent = recentColors(app);
  const next = pushRecentColor(recent, value);
  if (next.join() !== recent.join()) app.saveLocalStorage(KEY, next);
}
