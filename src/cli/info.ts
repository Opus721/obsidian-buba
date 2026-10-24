// `buba:info path=<file>`: tags, rating and comments of a file as one JSON, plus what generated it and how
// many generations use it as a reference. Reads storage only.
import type { Plugin } from 'obsidian';
import { CliError } from '../core/cli/answer.ts';
import { checkPath } from '../core/cli/input.ts';
import type { BubaStorage } from '../core/storage/types.ts';
import { registerBubaCli } from '../platform/cli.ts';
import { passportStorage } from '../platform/passports.ts';

export function registerInfo(plugin: Plugin): void {
  registerBubaCli(
    plugin,
    'info',
    'tags, rating, comments and generation of a file',
    { path: { value: '<file>', description: 'file path from the vault root' } },
    (params) => {
      const path = checkPath(params.path);
      const { vault } = plugin.app;
      if (!vault.getFileByPath(path))
        throw new CliError(vault.getFolderByPath(path) ? 'not-a-file' : 'not-found', path);
      const storage = storageOf(plugin);
      if (!storage) throw new CliError('no-storage');
      const { tags, rating, comments } = storage.get(path);
      const passports = passportStorage(plugin);
      const passport = passports?.passport(path) ?? null;
      return {
        path,
        tags,
        rating,
        comments: comments.map(({ id, text, at, device }) => ({ id, text, at, device })),
        generation: passport && { kind: passport.kind, model: passport.model, provider: passport.provider },
        usedIn: passports?.usedIn(path).length ?? 0,
      };
    },
  );
}

/** Plugin storage at call time, read like the tags module does: it opens in `onload` and may fail to open. */
function storageOf(plugin: Plugin): BubaStorage | undefined {
  return (plugin as Plugin & { storage?: BubaStorage }).storage;
}
