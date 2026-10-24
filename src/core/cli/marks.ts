// Flag parsing for the agent write commands `buba:tag`, `buba:rate`, `buba:comment` with the rules of
// `./input.ts`: failures throw `CliError` with a code before any write. No `obsidian` import.
import type { Rating } from '../storage/types.ts';
import { CliError } from './answer.ts';
import { checkPath, checkPaths, checkRating, checkTag, checkText, type Params } from './input.ts';

/** `buba:tag`: paths, the tag after `normalizeTag`, and whether to remove or add it. */
export interface TagQuery {
  paths: string[];
  tag: string;
  remove: boolean;
}

/** `buba:rate`: paths and a rating 0…5 (0 means no rating). */
export interface RateQuery {
  paths: string[];
  rating: Rating;
}

/** `buba:comment`: add text or delete a comment by id. */
export type CommentQuery = { path: string; text: string } | { path: string; delete: string };

/** `remove` is a bare flag that Obsidian passes as the string `"true"`; any other value gives `bad-query`. */
export function parseTag(params: Params): TagQuery {
  const paths = checkPaths(params);
  const tag = checkTag(params.tag);
  const { remove } = params;
  if (remove !== undefined && remove !== 'true') throw new CliError('bad-query', `remove=${remove}`);
  return { paths, tag, remove: remove === 'true' };
}

export function parseRate(params: Params): RateQuery {
  return { paths: checkPaths(params), rating: checkRating(params.rating) };
}

/** Exactly one of `text` and `delete`, else `bad-query`; the text is trimmed, as the file panel writes it. */
export function parseComment(params: Params): CommentQuery {
  const path = checkPath(params.path);
  const { text, delete: id } = params;
  if ((text === undefined) === (id === undefined))
    throw new CliError('bad-query', 'exactly one of the flags is needed: text=<text> or delete=<id>');
  return id === undefined ? { path, text: checkText(text) } : { path, delete: id };
}
