// Writes a generation passport for an agent: the `buba:passport` command and the inbox request share it.
// Everything is checked before the journal is touched: the result file, the passport itself, every
// reference and the board. Then storage writes the line, and with `canvas` the result card goes to the right
// of the board content, as `buba:canvas-add` does. Failures are `CliError` with a code.
import type { Vault } from 'obsidian';
import { CliError, type Fields } from '../core/cli/answer.ts';
import type { PassportCall } from '../core/cli/passport.ts';
import { findMoved, type VaultFileInfo } from '../core/generation/refs.ts';
import type { RefLocator } from '../core/generation/agent.ts';
import { PassportRefused, readPassportInput, refPaths } from '../core/storage/passport.ts';
import { inDataDir } from '../core/storage/types.ts';
import { hasFileCard, pointRightOfContent } from './canvas-cards.ts';
import { addCardsToCanvas, type CanvasJournal } from './canvas-write.ts';
import type { PassportStorage } from './passports.ts';

/** What the writer needs from `app`: the board write plus file lookups. */
export type PassportApp = Parameters<typeof addCardsToCanvas>[0] & {
  vault: Pick<Vault, 'getFileByPath' | 'getFolderByPath' | 'read'>;
};

function needFile(app: PassportApp, path: string): void {
  const { vault } = app;
  if (!vault.getFileByPath(path))
    throw new CliError(vault.getFolderByPath(path) ? 'not-a-file' : 'not-found', path);
}

/** Writes the call; the answer is `{path, refs, missing: [], canvas?: {path, added}}`. */
export async function writePassport(
  app: PassportApp,
  storage: PassportStorage | undefined,
  call: PassportCall,
  journal: CanvasJournal,
): Promise<Fields> {
  if (!storage) throw new CliError('no-storage');
  const { path, canvas } = call;
  needFile(app, path);
  let refs = 0;
  let passport = null;
  if (call.passport !== null) {
    const reading = readPassportInput(call.passport);
    if (!reading.ok) {
      const { field, reason } = reading.fault;
      throw new CliError('invalid', `${field} ${reason}`, { field, reason });
    }
    passport = reading.passport;
    const paths = refPaths(passport);
    const missing = paths.filter((ref) => !app.vault.getFileByPath(ref));
    if (missing.length) throw new CliError('ref-not-found', missing.join(', '), { missing });
    refs = passport.refs?.length ?? 0;
  }
  if (canvas !== undefined) needFile(app, canvas);
  try {
    await storage.setPassport(path, passport);
  } catch (error) {
    if (!(error instanceof PassportRefused)) throw error;
    const { code, field, reason } = error.fault;
    throw new CliError(code, `${field} ${reason}`, { field, reason });
  }
  const answer: Fields = { path, refs, missing: [] };
  if (canvas !== undefined) {
    const board = app.vault.getFileByPath(canvas);
    if (!board) throw new CliError('not-found', canvas);
    const text = await app.vault.read(board);
    // A request is retried after a failed removal and taken by every synced device: the card goes on the
    // board once, as the passport line is written once.
    const added = hasFileCard(text, path)
      ? 0
      : await addCardsToCanvas(app, canvas, [path], pointRightOfContent(text), journal);
    answer.canvas = { path: canvas, added };
  }
  return answer;
}

/** Vault files as the missing-reference lookup reads them. */
function filesOf(vault: Pick<Vault, 'getFiles'>): VaultFileInfo[] {
  return vault
    .getFiles()
    .filter((file) => !inDataDir(file.path))
    .map((file) => ({ path: file.path, name: file.name, size: file.stat.size }));
}

/**
 * Where references are now: the recorded path if the file is there, else the only file with the
 * fingerprint's name and size. The file list is read once per locator, on the first missing reference.
 */
export function refLocator(vault: Pick<Vault, 'getFileByPath' | 'getFiles'>): RefLocator {
  let files: VaultFileInfo[] | null = null;
  return (ref) => {
    if (vault.getFileByPath(ref.path)) return ref.path;
    return findMoved(ref.fp, (files ??= filesOf(vault)));
  };
}
