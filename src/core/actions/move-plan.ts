// Batch move plan: where each path goes, never overwriting. No `obsidian` import. On a name clash in the
// target folder the path is skipped and named in the batch summary, the same way Obsidian itself refuses.
import type { MoveOp } from './journal.ts';

/**
 * Why a path is not in the plan: `missing` (no file), `same-folder` (already in that folder), `into-itself`
 * (a folder into itself or its subfolder), `taken` (name taken). Wording for the batch summary is
 * `reasonText` in src/assets/actions/resume.ts.
 */
export type SkipReason = 'missing' | 'same-folder' | 'into-itself' | 'taken';
export type Skipped = { path: string; why: SkipReason };
export type MovePlan = { ops: MoveOp[]; skipped: Skipped[] };

/**
 * Plans moving `paths` into `targetFolder`; the vault root is `'/'` (or `''`), target paths have no leading
 * `/`. `exists` tells whether a path is on disk. A name is taken if the target is on disk or an earlier move
 * of the same batch already claimed it. Order follows `paths`.
 */
export function planMoves(
  paths: readonly string[],
  targetFolder: string,
  exists: (path: string) => boolean,
): MovePlan {
  const folder = targetFolder.replace(/^\/+|\/+$/g, '');
  const taken = new Set<string>();
  const plan: MovePlan = { ops: [], skipped: [] };
  for (const path of paths) {
    const cut = path.lastIndexOf('/');
    const name = path.slice(cut + 1);
    const to = folder === '' ? name : `${folder}/${name}`;
    const why: SkipReason | null = !exists(path)
      ? 'missing'
      : path.slice(0, Math.max(0, cut)) === folder
        ? 'same-folder'
        : folder === path || folder.startsWith(`${path}/`)
          ? 'into-itself'
          : taken.has(to) || exists(to)
            ? 'taken'
            : null;
    if (why) {
      plan.skipped.push({ path, why });
    } else {
      taken.add(to);
      plan.ops.push({ from: path, to });
    }
  }
  return plan;
}
