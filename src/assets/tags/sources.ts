// Grid sources "tag", "group" and "untagged", plus the "Untagged" tree item with a counter. Filtering uses
// storage queries (src/core/tags/sources.ts) over indexed files; "group" takes one pass over them. Adding or
// removing a tag, changing a group flag, or adding or deleting a file updates the grid and the item counter
// at once. The "tag" source accepts files added to its grid by tagging them with itself (`acceptAdded`);
// "group" and "untagged" do not declare that step. Editing file content (a note autosave) changes neither
// tags nor the path set, so the sources skip it and return the previous answer.
import type { Plugin } from 'obsidian';
import { t } from '../../core/i18n/dict/tags.ts';
import { normalizeTag, tagKey, type BubaStorage, type TagQueries } from '../../core/storage/types.ts';
import {
  groupSourcePaths,
  sourceTitle,
  tagSourcePaths,
  untaggedSourcePaths,
  type UntaggedSource,
} from '../../core/tags/sources.ts';
import { pathsVersionOf } from '../../platform/files/file-index.ts';
import { vaultFileIndex } from '../../platform/files/vault-index.ts';
import type { AddedTag, BubaAssets, GridSource } from '../api.ts';

type SourceStorage = Pick<BubaStorage, 'get' | 'filesWithTag' | 'untagged' | 'onChange' | 'addTags'> &
  Partial<Pick<TagQueries, 'groupFiles'>>;

const UNTAGGED: UntaggedSource = { kind: 'untagged' };

/**
 * Storage is looked up on every request: the plugin's `storage` field may appear after registration, and
 * until then all sources are empty. The storage change subscription is set as soon as storage is found, at
 * registration or on the first request; plugin unload removes it together with the file index subscription. A
 * source's answer for its key is cached until storage changes or the index path set changes (`pathsVersion`):
 * the grid asks for paths on every note autosave, and a recount over all files is not needed then. A copy is
 * returned since the grid mutates its array.
 */
export function registerTagSources(
  plugin: Plugin,
  assets: BubaAssets,
  storage: () => SourceStorage | undefined,
): void {
  const index = vaultFileIndex(plugin);
  const listeners = new Set<() => void>();
  const answers = new Map<string, string[]>();
  const changed = (): void => {
    answers.clear();
    for (const listener of [...listeners]) listener();
  };
  const onChange = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  let followed: SourceStorage | undefined;
  let unfollow = (): void => {};
  const current = (): SourceStorage | undefined => {
    const found = storage();
    if (found !== followed) {
      unfollow();
      followed = found;
      answers.clear();
      unfollow = found?.onChange(changed) ?? (() => {});
    }
    return found;
  };
  plugin.register(() => unfollow());
  current();

  // Index paths are collected once per path set: they filter "Untagged" and confirm a tagged file still
  // exists. The set version is checked on each request too: the grid may ask before this module receives the
  // index event.
  let files: { version: number | null; paths: string[]; known: Set<string> } | null = null;
  const indexed = () => {
    const version = pathsVersionOf(index);
    if (!files || files.version !== version) {
      const paths = index.allFiles().map((record) => record.path);
      files = { version, paths, known: new Set(paths) };
      answers.clear();
    }
    return files;
  };
  let seen = pathsVersionOf(index);
  plugin.register(
    index.onChange(() => {
      const version = pathsVersionOf(index);
      if (version !== null && version === seen) return;
      seen = version;
      files = null;
      changed();
    }),
  );
  /**
   * Answer for a key, cached until storage or the path set changes, returned as a copy; new storage clears
   * the cache.
   */
  const answer = (key: string, run: () => string[]): string[] => {
    current();
    indexed();
    let found = answers.get(key);
    if (!found) answers.set(key, (found = run()));
    return [...found];
  };
  const untagged = () => answer('untagged', () => untaggedSourcePaths(indexed().paths, current()));
  /** "File exists" check against index paths; the set is taken once per request. */
  const existing = (): ((path: string) => boolean) => {
    const { known } = indexed();
    return (path) => known.has(path);
  };

  plugin.register(
    assets.registerGridSource('tag', {
      title: (source) => sourceTitle({ kind: 'tag', tag: tagOf(source) }),
      paths: (source) =>
        answer(`tag:${tagKey(tagOf(source)) ?? ''}`, () =>
          tagSourcePaths(tagOf(source), current(), existing()),
        ),
      onChange,
      acceptAdded: (source, paths) => tagAdded(tagOf(source), paths, current()),
      // Hint for an empty tag; if storage did not open there is nothing to say about tags.
      empty: () => (current() ? [t('emptyTag')] : []),
    }),
  );
  plugin.register(
    assets.registerGridSource('tag-group', {
      title: (source) => sourceTitle({ kind: 'tag-group', group: groupOf(source) }),
      paths: (source) =>
        answer(`group:${tagKey(groupOf(source)) ?? ''}`, () =>
          groupSourcePaths(groupOf(source), current(), indexed().paths, existing()),
        ),
      onChange,
    }),
  );
  plugin.register(
    assets.registerGridSource(UNTAGGED.kind, {
      title: () => sourceTitle(UNTAGGED),
      paths: untagged,
      onChange,
    }),
  );
  plugin.register(
    assets.registerTreeItem({
      id: UNTAGGED.kind,
      title: sourceTitle(UNTAGGED),
      icon: 'eraser',
      source: UNTAGGED,
      count: () => untagged().length,
      onChange,
    }),
  );
}

/**
 * Files added to a tag's grid get that tag through a normal storage write: one journal entry per batch, the
 * file fingerprint on the first tag, and a tag of an exclusive group removes its siblings (a new file has
 * none). If storage did not open or refused, the files stay untagged and `error` holds the reason, which the
 * actions module's notice states in one sentence.
 */
async function tagAdded(
  tag: string,
  paths: readonly string[],
  storage: SourceStorage | undefined,
): Promise<AddedTag | null> {
  if (normalizeTag(tag) === null || !paths.length) return null;
  if (!storage) return { tag, error: t('storageClosed') };
  try {
    await storage.addTags([...paths], [tag]);
  } catch (error) {
    return { tag, error: error instanceof Error ? error.message : String(error) };
  }
  return { tag };
}

/** Tag of a `tag` source; not a string means broken leaf state, and such a tag has no files. */
function tagOf(source: GridSource): string {
  const { tag } = source as { tag?: unknown };
  return typeof tag === 'string' ? tag : '';
}

/** Group of a `tag-group` source; not a string means broken leaf state, and such a group has no files. */
function groupOf(source: GridSource): string {
  const { group } = source as { group?: unknown };
  return typeof group === 'string' ? group : '';
}
