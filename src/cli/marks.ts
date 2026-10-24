// `buba:tag`, `buba:rate`, `buba:comment`: tag, rating and comment of files from an agent command. A thin
// wrapper over storage writes: only storage writes journal lines in the data folder `__buba-data/` (and the
// legacy `Buba/`). A call with any invalid path fails as a whole before writing.
import type { Plugin } from 'obsidian';
import { CliError } from '../core/cli/answer.ts';
import { parseComment, parseRate, parseTag } from '../core/cli/marks.ts';
import type { BubaStorage } from '../core/storage/types.ts';
import { registerBubaCli } from '../platform/cli.ts';

const PATH_FLAG = { value: '<file>', description: 'file path from the vault root' };
const PATHS_FLAG = {
  value: '<JSON array>',
  description: 'several files: a JSON array of paths from the vault root, instead of path',
};

export function registerMarks(plugin: Plugin): void {
  registerBubaCli(
    plugin,
    'tag',
    'add or remove a tag on files',
    {
      path: PATH_FLAG,
      paths: PATHS_FLAG,
      tag: { value: '<tag>', description: 'tag; case-insensitive' },
      remove: { description: 'remove the tag instead of adding it' },
    },
    async (params) => {
      const { paths, tag, remove } = parseTag(params);
      const storage = writable(plugin, paths);
      if (remove) await storage.removeTags(paths, [tag]);
      else await storage.addTags(paths, [tag]);
      return { action: remove ? 'remove' : 'add', tag, paths };
    },
  );

  registerBubaCli(
    plugin,
    'rate',
    'set the rating of files',
    {
      path: PATH_FLAG,
      paths: PATHS_FLAG,
      rating: { value: '<0-5>', description: 'rating from 0 to 5; 0 is no rating' },
    },
    async (params) => {
      const { paths, rating } = parseRate(params);
      await writable(plugin, paths).setRating(paths, rating);
      return { rating, paths };
    },
  );

  registerBubaCli(
    plugin,
    'comment',
    'add a comment to a file or delete one by id',
    {
      path: PATH_FLAG,
      text: { value: '<text>', description: 'text of the new comment' },
      delete: { value: '<id>', description: 'id of the comment to delete (buba:info)' },
    },
    async (params) => {
      const query = parseComment(params);
      const { path } = query;
      const storage = writable(plugin, [path]);
      if ('text' in query) {
        const { id, text, at, device } = await storage.addComment(path, query.text);
        return { path, comment: { id, text, at, device } };
      }
      const id = query.delete;
      if (!storage.get(path).comments.some((comment) => comment.id === id))
        throw new CliError('no-comment', id);
      await storage.removeComment(path, id);
      return { path, deleted: id };
    },
  );
}

/**
 * Storage for writing, if every path is an existing file: a folder gives
 * `not-a-file`, nothing gives `not-found`, missing storage gives `no-storage`.
 * Storage is read from the plugin at call time, as in `buba:info`.
 */
function writable(plugin: Plugin, paths: readonly string[]): BubaStorage {
  const { vault } = plugin.app;
  for (const path of paths)
    if (!vault.getFileByPath(path))
      throw new CliError(vault.getFolderByPath(path) ? 'not-a-file' : 'not-found', path);
  const storage = (plugin as Plugin & { storage?: BubaStorage }).storage;
  if (!storage) throw new CliError('no-storage');
  return storage;
}
