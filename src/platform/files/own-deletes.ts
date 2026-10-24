// Paths Buba deletes itself, so the notice about a reference deleted outside Buba (src/generation) stays
// quiet for deletes the user already confirmed in a Buba dialog. A path is marked before the delete call and
// kept a short while after it: Obsidian may send the vault `delete` event after the call resolves. A
// declined delete drops the mark. One set for the plugin, like the inbox claims.

/** How long a path stays marked after its delete finished. */
export const OWN_DELETE_MS = 10_000;

/** Path → time its mark ends; `Infinity` while the delete runs. */
const marks = new Map<string, number>();

/** Marks a path Buba is about to delete. */
export function markOwnDelete(path: string): void {
  marks.set(path, Infinity);
}

/** The delete call finished: a deleted path stays marked for `OWN_DELETE_MS`, a kept one is unmarked. */
export function settleOwnDelete(path: string, deleted: boolean, now = Date.now()): void {
  if (deleted) marks.set(path, now + OWN_DELETE_MS);
  else marks.delete(path);
}

/** Whether Buba deleted the path itself just now. */
export function isOwnDelete(path: string, now = Date.now()): boolean {
  for (const [each, until] of marks) if (until <= now) marks.delete(each);
  return marks.has(path);
}
