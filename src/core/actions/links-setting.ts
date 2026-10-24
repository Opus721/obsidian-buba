// Whether to ask about Obsidian's "Automatically update internal links" setting before a batch move. Core
// rule, no `obsidian` import. While the setting is off, Obsidian asks "Update links" for every linked file,
// and closing that dialog leaves the link broken. The dialog and the setting access are in
// src/assets/actions/links-setting.ts and src/platform/files/links-setting.ts.

/** Vault links in `metadataCache.resolvedLinks` form: source (note, canvas) -> target -> count. */
export type ResolvedLinks = Record<string, Record<string, number>>;

/**
 * How many paths of the batch have links: a file is a link target with a count above zero, a folder contains
 * such a target (bounded by `/`). Notes and canvases count as sources alike. One pass over the links: each
 * target is checked together with its parent folders.
 */
export function linkedCount(paths: readonly string[], resolvedLinks: ResolvedLinks): number {
  const wanted = new Set(paths);
  const linked = new Set<string>();
  for (const targets of Object.values(resolvedLinks)) {
    for (const [target, count] of Object.entries(targets)) {
      if (count <= 0) continue;
      for (let path = target; path; path = path.slice(0, Math.max(0, path.lastIndexOf('/')))) {
        if (wanted.has(path)) linked.add(path);
      }
    }
  }
  return linked.size;
}

/**
 * State before a move: whether the setting is on (`null` if it cannot be read, Obsidian before 1.13.0),
 * whether this device already answered, and how many paths of the batch have links.
 */
export type LinkSettingState = { autoUpdate: boolean | null; answered: boolean; linked: number };

/** Ask only while the setting is off, there is no answer yet, and the batch has linked files. */
export function askLinkSetting({ autoUpdate, answered, linked }: LinkSettingState): boolean {
  return autoUpdate === false && !answered && linked > 0;
}
