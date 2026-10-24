// Plugin storage with generation passports, for modules that read passports without writing them: the file
// panel sections, the delete confirmation, `buba:info`. Writing goes through passport-write.ts.
import type { Plugin } from 'obsidian';
import type { BubaStorage, FilePassports } from '../core/storage/types.ts';

export type PassportStorage = BubaStorage & FilePassports;

/** Plugin storage with passports, read at call time: it opens in `onload` and may fail to open. */
export function passportStorage(plugin: Plugin): PassportStorage | undefined {
  const storage = (plugin as Plugin & { storage?: BubaStorage & Partial<FilePassports> }).storage;
  return storage?.setPassport ? (storage as PassportStorage) : undefined;
}
