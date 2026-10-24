// Wrapper over `Plugin.registerCliHandler` (Obsidian 1.12.2+) for Buba's agent commands. The handler never
// throws and declares no required flags: Obsidian prints a thrown error as plain `Error: …` text, while a
// Buba command always answers with one JSON object carrying the vault name. No Node or Electron imports: the
// plugin also loads on iPhone, and only desktop Obsidian has a command line.
import { Platform, type CliData, type CliFlags, type Plugin } from 'obsidian';
import { answer, CliError, refusal, type Fields } from '../core/cli/answer.ts';
import { checkFlags, checkFormat } from '../core/cli/input.ts';

/**
 * Command action: call flags to the fields of a success answer; refuse with `CliError`, anything else is
 * `internal`.
 */
export type CliAction = (params: CliData) => Fields | Promise<Fields>;

/**
 * Every command has a format flag, following the built-ins (`search format=text|json`); Buba only has `json`.
 */
const FORMAT_FLAG = { value: 'json', description: 'answer format: only json, the default' };

/**
 * Registers `buba:<action>` in desktop Obsidian only. The description has no `[Buba]: ` prefix: Obsidian adds
 * it. Flags are the command's plus `format`; an undeclared flag or another format is refused before the
 * action runs.
 */
export function registerBubaCli(
  plugin: Plugin,
  action: string,
  description: string,
  flags: CliFlags,
  run: CliAction,
): void {
  if (!Platform.isDesktopApp) return;
  const all: CliFlags = { ...flags, format: FORMAT_FLAG };
  const declared = Object.keys(all);
  plugin.registerCliHandler(`buba:${action}`, description, all, async (params) => {
    let vault = '';
    try {
      vault = plugin.app.vault.getName();
      checkFlags(params, declared);
      checkFormat(params);
      return answer(vault, await run(params));
    } catch (error) {
      return failure(vault, error);
    }
  });
}

/**
 * A `CliError` becomes a refusal with its code and fields; any other exception becomes `internal` with its
 * text.
 */
function failure(vault: string, error: unknown): string {
  if (error instanceof CliError) {
    try {
      return refusal(vault, error.code, error.message, error.data);
    } catch {
      return refusal(vault, error.code, error.message);
    }
  }
  const text = error instanceof Error ? error.message : String(error);
  return refusal(vault, 'internal', new CliError('internal', text || undefined).message);
}
