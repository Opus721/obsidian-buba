// Reading two data folders. A journal in the legacy folder with the same name as one in the new folder
// is the same device journal (the migration copy plus lines the old version appended after the copy):
// its lines already present in the new one are skipped, otherwise the index would see each line twice.
// No `obsidian` import.
import { JOURNAL_DIR, LEGACY_JOURNAL_DIR } from './types.ts';

export type JournalFile = { file: string; text: string };

const nameIn = (dir: string, file: string): string | null =>
  file.startsWith(`${dir}/`) ? file.slice(dir.length + 1) : null;

/**
 * Non-empty lines of the legacy text that are missing from the new one. The common prefix of the two texts
 * (up to the start of the line where they diverge) is not compared line by line: after the migration copy it
 * is almost the whole journal.
 */
export function missingLines(legacy: string, twin: string): string[] {
  if (twin.startsWith(legacy)) return [];
  const limit = Math.min(legacy.length, twin.length);
  // Common prefix in 64 Ki chunks (`startsWith` at an offset), then char by char inside the last chunk: char
  // by char a 23 MB journal takes 322-352 ms, in chunks 103-142 ms (measured on a 50,000-file model).
  const CHUNK = 65536;
  let common = 0;
  while (common + CHUNK <= limit && twin.startsWith(legacy.slice(common, common + CHUNK), common))
    common += CHUNK;
  while (common < limit && legacy.charCodeAt(common) === twin.charCodeAt(common)) common++;
  const cut = legacy.lastIndexOf('\n', common - 1) + 1;
  const seen = new Set(twin.slice(cut).split('\n'));
  return legacy
    .slice(cut)
    .split('\n')
    .filter((raw) => raw.trim() !== '' && !seen.has(raw));
}

/** Lines of a legacy journal missing from its twin in the new folder; without a twin, the journal as is. */
export function mergeLegacy(files: readonly JournalFile[]): JournalFile[] {
  const fresh = new Map<string, string>();
  for (const { file, text } of files) {
    const name = nameIn(JOURNAL_DIR, file);
    if (name !== null) fresh.set(name, text);
  }
  return files.map((entry) => {
    const name = nameIn(LEGACY_JOURNAL_DIR, entry.file);
    const twin = name === null ? undefined : fresh.get(name);
    if (twin === undefined) return entry;
    const rest = missingLines(entry.text, twin);
    return { file: entry.file, text: rest.length ? `${rest.join('\n')}\n` : '' };
  });
}
