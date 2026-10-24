// "By rating" comparison for the grid sort registry. Like the built-in keys (`compareFiles`,
// src/core/sort/sort-files.ts): by the key only, ascending, ties give 0; the grid adds the direction and the
// order of ties (by name, ascending, in both directions).

/** By stars from `ratingOf`; a path without a record (`undefined`) counts as 0, like an unrated file. */
export function compareByRating(
  ratingOf: (path: string) => number | undefined,
): (a: { readonly path: string }, b: { readonly path: string }) => number {
  return (a, b) => (ratingOf(a.path) ?? 0) - (ratingOf(b.path) ?? 0);
}
