// Name of a new folder from the Buba tree dialogs ("New subfolder…", "New folder alongside…", "New folder…"
// and the "+ New folder" row) and of a renamed one ("Rename…" in the folder menu): user input. Character rules are `safeFileName`, as for renaming a file
// (rename.ts): the name never leads outside the folder and has no characters Windows rejects. An unsuitable
// name is refused with a reason, not silently fixed. Clashes ignore case: Windows and iPhone disks do not
// tell "Lamp" from "lamp", and Obsidian answers "Folder already exists."; the file rename dialog counts the
// same way (src/assets/actions/menu-items.ts).
import { t } from '../i18n/dict/actions.ts';
import { availablePath, FORBIDDEN_SHOWN, MAX_NAME_LENGTH, safeFileName } from './import-names.ts';

/** Vault root: the root path in Obsidian (`TFolder.path`) and in the file index. */
export const ROOT = '/';

/** Where the folder appears: `inside` for "New subfolder…", `beside` for "New folder alongside…". */
export type NewFolderPlace = 'inside' | 'beside';

/** New folder path, or a refusal with a reason for the user. */
export type NewFolderTarget = { ok: true; path: string; name: string } | { ok: false; why: string };

/** No-break spaces: Obsidian turns them into plain spaces on write (`normalizePath`). */
const NO_BREAK_SPACE = /\u00a0|\u202f/g;
/** Name comparison key: case and Unicode form are ignored (Obsidian normalizes paths to NFC). */
const key = (name: string) => name.normalize('NFC').toLowerCase();
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Folder the new one goes into: `folder` itself for inside; for beside its parent (root at top level). */
export function newFolderParent(folder: string, place: NewFolderPlace): string {
  if (place === 'inside' || folder === ROOT) return folder;
  const slash = folder.lastIndexOf('/');
  return slash > 0 ? folder.slice(0, slash) : ROOT;
}

/** Parent folder of `path`: `ROOT` for a folder in the vault root. */
export function parentFolder(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash > 0 ? path.slice(0, slash) : ROOT;
}

/** Path of `name` in `parent`: no slash at the root, like Obsidian paths. */
export function childPath(parent: string, name: string): string {
  return parent === ROOT ? name : `${parent}/${name}`;
}

/**
 * Initial dialog value: "Untitled", then "Untitled 1", "2"… as in Obsidian; `siblings` are
 * names in the folder.
 */
export function untitledFolderName(siblings: readonly string[]): string {
  const taken = new Set(siblings.map(key));
  // Same name Obsidian gives a new unnamed folder (`createNewFolder`): "Untitled", translated.
  return availablePath(ROOT, t('untitled'), (name) => taken.has(key(name)));
}

/**
 * Path of a new folder in `parent` from `input`. The name is normalized the way Obsidian writes a path
 * (no-break spaces to spaces, NFC) and trimmed. Refused when empty, when `safeFileName` would change it, or
 * when the folder already has a file or folder of that name in any case (the refusal names the existing one).
 * `siblings` are the names of everything in `parent`.
 */
export function newFolderTarget(parent: string, input: string, siblings: readonly string[]): NewFolderTarget {
  const name = input.replace(NO_BREAK_SPACE, ' ').normalize('NFC').trim();
  if (!name) return { ok: false, why: t('emptyName') };
  if (safeFileName(name) !== name)
    return {
      ok: false,
      why: t('badFolderName', { chars: FORBIDDEN_SHOWN, device: 'CON', max: MAX_NAME_LENGTH }),
    };
  const same = siblings.find((sibling) => key(sibling) === key(name));
  if (same !== undefined) {
    const exact = same === name;
    const why =
      parent === ROOT
        ? t(exact ? 'folderExistsRoot' : 'folderExistsRootCase', { name: same })
        : t(exact ? 'folderExistsIn' : 'folderExistsInCase', { name: same, folder: nameOf(parent) });
    return { ok: false, why };
  }
  return { ok: true, path: childPath(parent, name), name };
}

/**
 * New path of folder `path` renamed to `input`, by the rule for a new folder in its parent. `siblings` are
 * the names of everything else in the parent: the folder's own name is left out, so changing only the case
 * is allowed. The same name gives the same path, and there is nothing to rename.
 */
export function renameFolderTarget(
  path: string,
  input: string,
  siblings: readonly string[],
): NewFolderTarget {
  return newFolderTarget(parentFolder(path), input, siblings);
}
