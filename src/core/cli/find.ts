// `buba:find`: files with a tag (case-insensitive) or without any tag, in the whole vault or in a folder with
// subfolders, with the tags and rating of each. Selection matches the grid's "Tag" and "Untagged" sources
// (`src/core/tags/sources.ts`); Eagle returns items with tags and rating the same way
// (https://api.eagle.cool/item/list). No `obsidian` import.
import type { BubaStorage, Rating } from '../storage/types.ts';
import { tagSourcePaths, untaggedSourcePaths } from '../tags/sources.ts';
import { CliError } from './answer.ts';
import { checkPath, checkTag, type Params } from './input.ts';

/** Query: a tag (`null` for untagged files) and a folder (`null` for the whole vault). */
export interface FindQuery {
  readonly tag: string | null;
  readonly folder: string | null;
}

/** A file in the answer. */
export interface FoundFile {
  path: string;
  tags: string[];
  rating: Rating;
}

/** Vault files visible to the grid: all paths and an existence check. */
export interface VaultFiles {
  all: () => string[];
  exists: (path: string) => boolean;
}

/**
 * Exactly one of `tag=<tag>` and bare `untagged` (Obsidian passes it as the string `"true"`), else
 * `bad-query`; the tag goes through `checkTag`, the optional `folder=<folder>` through `checkPath`.
 */
export function parseFind(params: Params): FindQuery {
  const { tag, untagged, folder } = params;
  if ((tag === undefined) === (untagged === undefined) || (untagged !== undefined && untagged !== 'true'))
    throw new CliError('bad-query', 'exactly one is needed: tag=<tag> or untagged');
  return {
    tag: tag === undefined ? null : checkTag(tag),
    folder: folder === undefined ? null : checkPath(folder),
  };
}

/**
 * Files of the query with tags and rating. With a folder, only paths inside it and its subfolders (`refs2/`
 * is not inside `refs`); sorted by path as strings, so the order is stable between calls.
 */
export function findFiles(
  query: FindQuery,
  storage: Pick<BubaStorage, 'get' | 'filesWithTag' | 'untagged'>,
  files: VaultFiles,
): FoundFile[] {
  const inFolder = (path: string) => query.folder === null || path.startsWith(`${query.folder}/`);
  const paths =
    query.tag === null
      ? untaggedSourcePaths(files.all().filter(inFolder), storage)
      : tagSourcePaths(query.tag, storage, files.exists).filter(inFolder);
  return [...new Set(paths)].sort().map((path) => {
    const { tags, rating } = storage.get(path);
    return { path, tags, rating };
  });
}
