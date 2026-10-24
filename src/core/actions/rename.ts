// New file name from the tile menu "Rename" dialog: user input. The name never leads outside the folder and
// has no characters Windows rejects. An unsuitable name is refused with a reason, not silently fixed, so the
// user sees the name the file will get. Name rules are `safeFileName` (import-names.ts).
import { t } from '../i18n/dict/actions.ts';
import { FORBIDDEN_SHOWN, MAX_NAME_LENGTH, safeFileName } from './import-names.ts';

/** Rename target: a path from the vault root, or a refusal with a reason for the user. */
export type RenameTarget = { ok: true; to: string } | { ok: false; why: string };

/** Extension as in Obsidian (`TFile.extension`): after the last dot; a leading dot is not an extension. */
function splitExtension(name: string): [stem: string, extension: string] {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Initial dialog value: the file name without its extension. */
export function renameField(path: string, full = false): string {
  return full ? nameOf(path) : splitExtension(nameOf(path))[0];
}

/**
 * New path for `path` from `input`: same folder, the extension is kept, and typing the same extension does
 * not double it. Refused when empty, when `safeFileName` would change the name, when the name is unchanged,
 * or when the folder already has that name. `exists` decides whether a path is taken; the same file in a
 * different case does not count as taken.
 */
export function renameTarget(
  path: string,
  input: string,
  exists: (path: string) => boolean,
  full = false,
): RenameTarget {
  const typed = input.trim();
  if (!typed) return { ok: false, why: t('emptyName') };
  const folder = path.slice(0, Math.max(path.lastIndexOf('/'), 0));
  const [, extension] = splitExtension(nameOf(path));
  const sameExtension =
    extension !== '' &&
    typed.length > extension.length &&
    typed.toLowerCase().endsWith(extension.toLowerCase());
  const name = full || sameExtension ? typed : typed + extension;
  if (safeFileName(name) !== name)
    return {
      ok: false,
      why: t('badFileName', { chars: FORBIDDEN_SHOWN, device: 'CON', max: MAX_NAME_LENGTH }),
    };
  const to = folder ? `${folder}/${name}` : name;
  if (to === path) return { ok: false, why: t('nameUnchanged') };
  if (to.toLowerCase() !== path.toLowerCase() && exists(to))
    return { ok: false, why: t('fileExists', { name }) };
  return { ok: true, to };
}
