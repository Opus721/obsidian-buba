// `buba:find tag=<tag> | untagged [folder=<folder>]`: paths of files with a tag, or without tags, with their
// tags and rating as one JSON. Reads storage only; filtering is in `src/core/cli/find.ts`.
import type { Plugin } from 'obsidian';
import { CliError } from '../core/cli/answer.ts';
import { findFiles, parseFind } from '../core/cli/find.ts';
import type { BubaStorage } from '../core/storage/types.ts';
import { registerBubaCli } from '../platform/cli.ts';
import { isHidden } from '../platform/files/file-index.ts';

export function registerFind(plugin: Plugin): void {
  registerBubaCli(
    plugin,
    'find',
    'paths of files with a tag or without tags — in the whole vault or in a folder with subfolders, with their tags and rating',
    {
      tag: { value: '<tag>', description: 'files with this tag, case-insensitive' },
      untagged: { description: 'files without any tag' },
      folder: {
        value: '<folder>',
        description: 'only in this folder and its subfolders, path from the vault root',
      },
    },
    (params) => {
      const query = parseFind(params);
      const { vault } = plugin.app;
      if (query.folder !== null && !vault.getFolderByPath(query.folder))
        throw new CliError(vault.getFileByPath(query.folder) ? 'not-a-folder' : 'not-found', query.folder);
      const storage = (plugin as Plugin & { storage?: BubaStorage }).storage;
      if (!storage) throw new CliError('no-storage');
      // The same files the grid sees: the service `Buba` folder and `.obsidian` are hidden.
      const files = findFiles(query, storage, {
        all: () =>
          vault
            .getFiles()
            .map((file) => file.path)
            .filter((path) => !isHidden(path)),
        exists: (path) => !isHidden(path) && vault.getFileByPath(path) !== null,
      });
      return { count: files.length, files };
    },
  );
}
