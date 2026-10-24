import type { App } from 'obsidian';
import { isDeviceId } from '../core/storage/types.ts';

/** Local storage key; Obsidian prefixes it with the vault id (measured). */
const KEY = 'buba-device';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * This device's id in this vault. Kept in local storage, not in vault files: otherwise a computer and a phone
 * syncing one vault would write to the same journal. A missing or malformed id is replaced with a new 8-char
 * `[a-z0-9]` one.
 */
export function deviceId(app: App): string {
  const saved: unknown = app.loadLocalStorage(KEY);
  if (isDeviceId(saved)) return saved;
  let id = '';
  while (id.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(8))) {
      // 252 = 36 × 7: higher bytes are dropped so every character is equally likely.
      if (byte < 252 && id.length < 8) id += ALPHABET.charAt(byte % 36);
    }
  }
  app.saveLocalStorage(KEY, id);
  return id;
}
