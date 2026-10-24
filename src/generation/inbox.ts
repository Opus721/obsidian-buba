// The `passport` kind of the inbox: an agent without the Obsidian command line drops
// `{kind: "passport", path, passport, canvas?}` into the inbox and the passport is written as by
// `buba:passport`. A result or reference that sync has not brought yet makes the request wait.
import type { Plugin } from 'obsidian';
import { CliError } from '../core/cli/answer.ts';
import { passportRequest } from '../core/cli/passport.ts';
import { DEFAULT_KIND } from '../core/inbox/request.ts';
import type { CanvasJournal } from '../platform/canvas-write.ts';
import { deviceId } from '../platform/device.ts';
import { actionJournal, type ActionJournal } from '../platform/files/action-journal.ts';
import { registerInboxKind } from '../platform/inbox.ts';
import { writePassport } from '../platform/passport-write.ts';
import { passportStorage } from '../platform/passports.ts';

/** Refusals that can pass by themselves: files still on their way, storage still opening. */
const WAIT = new Set(['not-found', 'ref-not-found', 'no-storage']);

export function registerPassportInbox(plugin: Plugin): void {
  const { app } = plugin;
  let journal: ActionJournal | null = null;
  const record: CanvasJournal = (entry) =>
    (journal ??= actionJournal(app, deviceId(app))).recordCanvasWrite(entry);
  registerInboxKind(plugin, DEFAULT_KIND, async (request) => {
    try {
      await writePassport(app, passportStorage(plugin), passportRequest(request), record);
      return { done: true };
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
      return WAIT.has(error.code) ? { wait: error.message } : { refused: error.message };
    }
  });
}
