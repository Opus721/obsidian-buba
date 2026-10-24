// Parsing of `buba:canvas-add`: board, card paths and the per-call limit. Failures throw `CliError` before
// the board or the log is read. No `obsidian` import.
import { CliError } from './answer.ts';
import { checkPath, checkPaths, type Params } from './input.ts';

/**
 * More cards than this in one agent call is refused with the count and the board is untouched: over 100 cards
 * should not land without a person looking at the board, and an agent cannot press the drop confirmation.
 * Equal in value to the drop threshold `CONFIRM_ABOVE` but independent of it.
 */
export const MAX_CARDS_PER_CALL = 100;

export interface CanvasAddInput {
  /** The `.canvas` board, from the vault root. */
  canvas: string;
  /** Card files without duplicates, in order of first appearance. */
  paths: string[];
}

/**
 * Flags `canvas=<board.canvas>` and `path=<file>` or `paths=<JSON array>`. The board is checked as a path and
 * must end in `.canvas` (else `not-a-canvas`); paths are checked as a list, and more than
 * `MAX_CARDS_PER_CALL` after removing duplicates gives `too-many` with their count.
 */
export function parseCanvasAdd(params: Params): CanvasAddInput {
  const canvas = checkPath(params.canvas);
  if (!canvas.endsWith('.canvas')) throw new CliError('not-a-canvas', canvas);
  const paths = checkPaths(params);
  if (paths.length > MAX_CARDS_PER_CALL) {
    throw new CliError(
      'too-many',
      `${cards(paths.length)} — over the limit of ${MAX_CARDS_PER_CALL}, the board is untouched`,
    );
  }
  return { canvas, paths };
}

/** The count with "card" in the right form, by the CLDR English plural rules (`Intl.PluralRules`). */
function cards(count: number): string {
  return `${count} ${new Intl.PluralRules('en').select(count) === 'one' ? 'card' : 'cards'}`;
}
