// `buba:passport` writes a file's generation passport; `buba:passport-get` reads it as the agent gets it
// with "Copy for agent", plus the files that use this one as a reference; `buba:passport-help` gives the
// format and the steps, so an agent learns them from the command list. The write goes through
// `writePassport` (src/platform/passport-write.ts), shared with the inbox.
import type { Plugin } from 'obsidian';
import { CliError, type Fields } from '../core/cli/answer.ts';
import { checkPath } from '../core/cli/input.ts';
import { parsePassportCall, passportRequestText } from '../core/cli/passport.ts';
import { REQUEST_MAX_BYTES } from '../core/inbox/request.ts';
import { agentPassport } from '../core/generation/agent.ts';
import { passportGuide } from '../core/generation/guide.ts';
import { registerBubaCli } from '../platform/cli.ts';
import { deviceId } from '../platform/device.ts';
import { actionJournal, type ActionJournal } from '../platform/files/action-journal.ts';
import { claimRequest, releaseRequest } from '../platform/inbox.ts';
import { refLocator, writePassport } from '../platform/passport-write.ts';
import { passportStorage } from '../platform/passports.ts';
import type { CanvasJournal } from '../platform/canvas-write.ts';

export function registerPassport(plugin: Plugin): void {
  const { app } = plugin;
  let journal: ActionJournal | null = null;
  const record: CanvasJournal = (entry) =>
    (journal ??= actionJournal(app, deviceId(app))).recordCanvasWrite(entry);

  registerBubaCli(
    plugin,
    'passport',
    'write the generation passport of a file: what made it, the prompt, references and parameters; format in buba:passport-help',
    {
      path: { value: '<file>', description: 'the generated file from the vault root' },
      passport: {
        value: '<JSON>',
        description: 'passport object: kind, model, provider, createdAt and more, see buba:passport-help',
      },
      file: {
        value: '<request.json>',
        description: 'a request in __buba-data/inbox instead of path and passport',
      },
      canvas: { value: '<board.canvas>', description: 'also put the file card on this board' },
      clear: { value: 'true', description: 'remove the passport of path' },
    },
    async (params): Promise<Fields> => {
      const query = parsePassportCall(params);
      if (!('file' in query)) return writePassport(app, passportStorage(plugin), query, record);
      const { file } = query;
      if (!claimRequest(file)) throw new CliError('not-found', `${file} is being taken by the inbox`);
      try {
        if (!(await app.vault.adapter.exists(file))) throw new CliError('not-found', file);
        if (((await app.vault.adapter.stat(file))?.size ?? 0) > REQUEST_MAX_BYTES)
          throw new CliError('too-large', `${file} is larger than ${REQUEST_MAX_BYTES / 1024} KB, not read`);
        const call = passportRequestText(await app.vault.adapter.read(file), query.canvas);
        const answer = await writePassport(app, passportStorage(plugin), call, record);
        await app.vault.adapter.remove(file);
        return { ...answer, file };
      } finally {
        releaseRequest(file);
      }
    },
  );

  registerBubaCli(
    plugin,
    'passport-get',
    'generation passport of a file as an agent copies it, and the generations that use the file',
    { path: { value: '<file>', description: 'file path from the vault root' } },
    (params) => {
      const path = checkPath(params.path);
      const { vault } = app;
      if (!vault.getFileByPath(path))
        throw new CliError(vault.getFolderByPath(path) ? 'not-a-file' : 'not-found', path);
      const storage = passportStorage(plugin);
      if (!storage) throw new CliError('no-storage');
      const passport = storage.passport(path);
      const view = passport ? agentPassport(path, passport, refLocator(vault)) : { path, passport: null };
      return { ...view, usedIn: storage.usedIn(path) };
    },
  );

  registerBubaCli(
    plugin,
    'passport-help',
    'how to record what made a generated file: steps, passport fields, roles, parameters, limits',
    {},
    () => ({ guide: passportGuide() }),
  );
}
