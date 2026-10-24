// `buba:canvas-add canvas=<board.canvas> paths=<JSON array>`: file cards in a row to the
// right of the board content. Only `addCardsToCanvas` (src/platform/canvas-write.ts)
// writes: an open board through its view, a closed one through the adapter; the previous
// board text goes to the action log before the write, as for a tile drop.
import type { Plugin, Vault } from 'obsidian';
import { CliError, type Fields } from '../core/cli/answer.ts';
import { MAX_CARDS_PER_CALL, parseCanvasAdd } from '../core/cli/canvas.ts';
import type { Params } from '../core/cli/input.ts';
import { pointRightOfContent } from '../platform/canvas-cards.ts';
import { addCardsToCanvas, type CanvasJournal } from '../platform/canvas-write.ts';
import { registerBubaCli } from '../platform/cli.ts';
import { deviceId } from '../platform/device.ts';
import { actionJournal, type ActionJournal } from '../platform/files/action-journal.ts';

/** What the action needs from `app`: what the board write needs, plus folder lookup for the error code. */
type CanvasAddApp = Parameters<typeof addCardsToCanvas>[0] & {
  vault: Pick<Vault, 'getFolderByPath'>;
};

export function registerCanvasAdd(plugin: Plugin): void {
  const { app } = plugin;
  // One action log per module, created on the first write, as for a tile drop (src/canvas/drop.ts).
  let journal: ActionJournal | null = null;
  const record: CanvasJournal = (entry) =>
    (journal ??= actionJournal(app, deviceId(app))).recordCanvasWrite(entry);
  registerBubaCli(
    plugin,
    'canvas-add',
    'file cards in a row to the right of the board content; the previous board text goes to the action log',
    {
      canvas: { value: '<board.canvas>', description: '.canvas board from the vault root' },
      path: { value: '<file>', description: 'one file from the vault root' },
      paths: {
        value: '<JSON array>',
        description: `files from the vault root as a JSON array of strings, at most ${MAX_CARDS_PER_CALL}`,
      },
    },
    (params) => canvasAdd(app, params, record),
  );
}

/**
 * Checks the input, the board and every path before touching the log; any failure is a `CliError` and leaves
 * the board and the log untouched. The row starts right of the board content as read from disk.
 */
export async function canvasAdd(app: CanvasAddApp, params: Params, journal: CanvasJournal): Promise<Fields> {
  const { canvas, paths } = parseCanvasAdd(params);
  const { vault } = app;
  const board = vault.getFileByPath(canvas);
  if (!board) throw new CliError(vault.getFolderByPath(canvas) ? 'not-a-file' : 'not-found', canvas);
  for (const path of paths) {
    if (!vault.getFileByPath(path))
      throw new CliError(vault.getFolderByPath(path) ? 'not-a-file' : 'not-found', path);
  }
  const at = pointRightOfContent(await vault.read(board));
  const added = await addCardsToCanvas(app, canvas, paths, at, journal);
  return { canvas, added };
}
