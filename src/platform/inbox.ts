// The inbox watcher: agents without the Obsidian command line drop `<name>.json` into the inbox folder and
// the plugin takes it. One watcher serves all kinds; a module registers the handler of its kind, so modules
// stay independent. A taken request is removed; one waiting for files that sync has not brought yet is
// retried when files appear and refused after a week; a bad one goes to `rejected/` with a reason file next
// to it. A kind no handler knows is left in place for the version that knows it. The request is Buba's own
// service file, so it is read, moved and removed through the adapter.
import type { App, Plugin, TAbstractFile } from 'obsidian';
import {
  expired,
  INBOX_DIR,
  isInboxRequest,
  readInboxRequest,
  REJECTED_DIR,
  rejectedPaths,
  REQUEST_MAX_BYTES,
} from '../core/inbox/request.ts';
import { inDataDir } from '../core/storage/types.ts';

/** What a handler made of a request: taken, waiting for files (with the reason), or refused. */
export type InboxOutcome = { done: true } | { wait: string } | { refused: string };
export type InboxHandler = (request: Record<string, unknown>, path: string) => Promise<InboxOutcome>;

/** A request is taken this long after its last change: sync and editors write a file in several steps, ms. */
const SETTLE_MS = 2000;
/** Waiting requests are retried this long after the last file appeared, ms. */
const RETRY_MS = 2000;

interface Inbox {
  kinds: Map<string, InboxHandler>;
  waiting: Set<string>;
  timers: Map<string, number>;
  retry: number | null;
}

const inboxes = new WeakMap<App, Inbox>();
/** Requests being handled right now, by the watcher or by a command reading the same file. */
const claimed = new Set<string>();

/** Takes `path` for handling; `false` if someone already has it. */
export function claimRequest(path: string): boolean {
  const key = path.toLowerCase();
  if (claimed.has(key)) return false;
  claimed.add(key);
  return true;
}

export function releaseRequest(path: string): void {
  claimed.delete(path.toLowerCase());
}

/** Registers the handler of `kind`; the first call starts the watcher once the layout is ready. */
export function registerInboxKind(plugin: Plugin, kind: string, handler: InboxHandler): void {
  const { app } = plugin;
  let inbox = inboxes.get(app);
  if (!inbox) {
    inbox = { kinds: new Map(), waiting: new Set(), timers: new Map(), retry: null };
    inboxes.set(app, inbox);
    const own = inbox;
    plugin.register(() => {
      for (const timer of own.timers.values()) window.clearTimeout(timer);
      if (own.retry !== null) window.clearTimeout(own.retry);
      inboxes.delete(app);
    });
    app.workspace.onLayoutReady(() => watch(plugin, own));
  }
  inbox.kinds.set(kind, handler);
}

function watch(plugin: Plugin, inbox: Inbox): void {
  const { vault } = plugin.app;
  const touched = (item: TAbstractFile): void => {
    if (isInboxRequest(item.path)) later(plugin, inbox, item.path);
    else if (!inDataDir(item.path) && inbox.waiting.size) retryWaiting(plugin, inbox);
  };
  plugin.registerEvent(vault.on('create', touched));
  plugin.registerEvent(vault.on('modify', touched));
  plugin.registerEvent(vault.on('rename', touched));
  void scan(plugin, inbox);
}

/** Every request already in the inbox, as at startup. */
async function scan(plugin: Plugin, inbox: Inbox): Promise<void> {
  const { adapter } = plugin.app.vault;
  try {
    if (!(await adapter.exists(INBOX_DIR))) return;
    const { files } = await adapter.list(INBOX_DIR);
    for (const path of files) if (isInboxRequest(path)) await take(plugin, inbox, path);
  } catch (error) {
    console.error("Buba: the inbox couldn't be read", error);
  }
}

function later(plugin: Plugin, inbox: Inbox, path: string): void {
  const old = inbox.timers.get(path);
  if (old !== undefined) window.clearTimeout(old);
  inbox.timers.set(
    path,
    window.setTimeout(() => {
      inbox.timers.delete(path);
      void take(plugin, inbox, path);
    }, SETTLE_MS),
  );
}

function retryWaiting(plugin: Plugin, inbox: Inbox): void {
  if (inbox.retry !== null) window.clearTimeout(inbox.retry);
  inbox.retry = window.setTimeout(() => {
    inbox.retry = null;
    void (async () => {
      for (const path of [...inbox.waiting]) await take(plugin, inbox, path);
    })();
  }, RETRY_MS);
}

/** Handles one request; any failure is logged and leaves the request where it is. */
async function take(plugin: Plugin, inbox: Inbox, path: string): Promise<void> {
  if (!claimRequest(path)) return;
  const { adapter } = plugin.app.vault;
  try {
    if (!(await adapter.exists(path))) {
      inbox.waiting.delete(path);
      return;
    }
    const size = (await adapter.stat(path))?.size ?? 0;
    if (size > REQUEST_MAX_BYTES) {
      await reject(
        plugin,
        inbox,
        path,
        `The request is larger than ${REQUEST_MAX_BYTES / 1024} KB, not read`,
      );
      return;
    }
    const reading = readInboxRequest(await adapter.read(path));
    if (!reading.ok) {
      await reject(plugin, inbox, path, `The request is ${reading.reason}`);
      return;
    }
    const handler = inbox.kinds.get(reading.kind);
    // A kind from a newer version: not ours to remove.
    if (!handler) return;
    const outcome = await handler(reading.request, path);
    if ('done' in outcome) {
      inbox.waiting.delete(path);
      await adapter.remove(path);
    } else if ('refused' in outcome) {
      await reject(plugin, inbox, path, outcome.refused);
    } else {
      const stat = await adapter.stat(path);
      const since = Math.min(stat?.ctime ?? Date.now(), stat?.mtime ?? Date.now());
      if (expired(since, Date.now())) await reject(plugin, inbox, path, `Waited a week: ${outcome.wait}`);
      else inbox.waiting.add(path);
    }
  } catch (error) {
    console.error(`Buba: the inbox request ${path} was not taken`, error);
  } finally {
    releaseRequest(path);
  }
}

/** Moves the request to `rejected/` and writes the reason next to it. */
async function reject(plugin: Plugin, inbox: Inbox, path: string, reason: string): Promise<void> {
  const { adapter } = plugin.app.vault;
  inbox.waiting.delete(path);
  if (!(await adapter.exists(REJECTED_DIR))) await adapter.mkdir(REJECTED_DIR);
  const { files } = await adapter.list(REJECTED_DIR);
  const taken = new Set(files.map((file) => file.toLowerCase()));
  const target = rejectedPaths(path, (each) => taken.has(each.toLowerCase()));
  await adapter.rename(path, target.file);
  await adapter.write(target.reason, `${reason}\n`);
}
