// What a delete takes from generations: the files about to be deleted that are references of generations
// staying in the vault. A result deleted in the same batch does not count: nothing is left to lose its
// thumbnail. Read by the delete confirmation (src/assets/actions/menu-items.ts) and by the notice after a
// delete made outside Buba (src/generation/deleted-outside.ts). No `obsidian` import.

/** A file being deleted and the generations that name it as a reference. */
export interface ReferenceUse {
  path: string;
  /** Results that stay: existing files outside the deleted batch, newest first as `usedIn` gives them. */
  results: string[];
}

/** Files of `paths` that stay references of other generations, in the order given. */
export function referenceUse(
  paths: readonly string[],
  usedIn: (path: string) => readonly string[],
): ReferenceUse[] {
  const going = new Set(paths);
  return paths.flatMap((path) => {
    const results = usedIn(path).filter((result) => !going.has(result));
    return results.length ? [{ path, results }] : [];
  });
}

/** Generations touched by the uses, each once. */
export function generationCount(uses: readonly ReferenceUse[]): number {
  return new Set(uses.flatMap(({ results }) => results)).size;
}
