// Per-device error log: iPhone has no console, so Buba errors are read from a file. Each device has its own
// append-only file, `.log` rather than `.jsonl` so the tag storage never reads it. A load line holds the
// version, build commit and platform; then one line per Buba error.
// - Desktop (`Platform.isDesktopApp`, also in mobile emulation): `<plugin folder>/errors-<device>.log`, where
//   Obsidian keeps plugin files (`manifest.dir`, next to `data.json`): the file explorer, grid and vault
//   events do not see it, and Obsidian Sync does not carry it from the plugin folder. The load line is
//   written on every start.
// - Phone (iPhone, iPad, Android): `__buba-data/<device>-errors.log` (`JOURNAL_DIR`), which Sync carries to
//   the desktop where the log is read. Written only on error: the load line waits in memory and goes out in
//   one append with the run's first error; with no errors there is neither file nor data folder.
// Old desktop error logs in the data folder are not moved, read or deleted. Capture works like browser error
// collectors (Sentry's GlobalHandlers and CaptureConsole): the window `error` event, the `unhandledrejection`
// event, and a `console.error` wrapper; no network, no third-party plugin.
import { Platform, type Plugin } from 'obsidian';
import { JOURNAL_DIR } from '../core/storage/types.ts';
import { deviceId } from './device.ts';
import { appendJournal } from './storage/journal-append.ts';
import { ensureJournalDir } from './storage/vault-io.ts';

/** Prefix of Buba errors in the console. */
const PREFIX = 'Buba:';
/**
 * Buba code in a stack. Obsidian runs a plugin's `main.js` as source `plugin:buba`, e.g. `at Oo
 * (plugin:buba:14:102)` (measured in Obsidian 1.14.4); the plugin folder path covers a phone that names the
 * source by path.
 */
const MARKERS = ['plugin:buba:', 'plugins/buba/'];
/** Error lines per run: the log travels via Sync to every device. */
const MAX_ERRORS = 200;
/** Characters per log line. */
const MAX_LINE = 4000;
/** Platform in the load line: Obsidian's `Platform` flags. */
const PLATFORM_FLAGS = ['isIosApp', 'isAndroidApp', 'isDesktopApp', 'isMobile', 'isPhone'] as const;

type Kind = 'load' | 'console' | 'error' | 'rejection' | 'limit';

/**
 * Stack of a value, if any: for an `Error` from another window `instanceof Error` is false, but the stack is
 * a string.
 */
function stackOf(value: unknown): string {
  try {
    const stack = (value as { stack?: unknown } | null)?.stack;
    return typeof stack === 'string' ? stack : '';
  } catch {
    return '';
  }
}

const fromBuba = (value: unknown): boolean => {
  const stack = stackOf(value);
  return MARKERS.some((marker) => stack.includes(marker));
};

/**
 * A value as text: an error gives name, message and stack (Safari's stack lacks the first "Name: message"
 * line, so it is added), a string stays as is, anything else is JSON or `String`.
 */
function describe(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    const stack = stackOf(value);
    if (value instanceof Error || stack) {
      const head = String(value);
      if (!stack) return head;
      return stack.startsWith(head) ? stack : `${head}\n${stack}`;
    }
    return JSON.stringify(value) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/** Log line: time, kind, text on one line (stack newlines become " | "), capped at the limit. */
function lineOf(kind: Kind, text: string): string {
  const line = `${new Date().toISOString()} ${kind} ${text.replace(/\s*[\r\n]+\s*/g, ' | ').trim()}`;
  if (line.length <= MAX_LINE) return line;
  // Do not split a surrogate pair: half a character would become "�" in UTF-8.
  const cut = line.slice(0, MAX_LINE - 1).replace(/[\uD800-\uDBFF]$/, '');
  return `${cut}…`;
}

/**
 * Plugin folder in the vault: `manifest.dir`, or `<configDir>/plugins/<id>` without it (as previews do,
 * `store.ts`).
 */
function pluginDir(plugin: Plugin): string {
  return plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
}

/**
 * Starts this device's error log: Buba errors until plugin unload; the load line at once on desktop, with the
 * first error on phones. Call first in `onload` so a storage open error is logged too. Unload removes the
 * console wrapper and window listeners.
 */
export function startErrorLog(plugin: Plugin, build: string): void {
  const { app } = plugin;
  const { adapter } = app.vault;
  const device = deviceId(app);
  const desktop = Platform.isDesktopApp;
  const file = desktop ? `${pluginDir(plugin)}/errors-${device}.log` : `${JOURNAL_DIR}/${device}-errors.log`;
  const platform = PLATFORM_FLAGS.map((flag) => `${flag}: ${Platform[flag]}`).join(', ');
  /** Load line with the start time, until it is written to the file. */
  let pending: string | undefined = lineOf(
    'load',
    `version: ${plugin.manifest.version}, build: ${build}, ${platform}`,
  );
  let queue: Promise<void> = Promise.resolve();
  let errors = 0;

  // Writes go one at a time, in order; a load line not yet written goes first in the same append. Only phones
  // create the data folder, and only to write: the plugin folder exists since the plugin loaded from it. A
  // failed write uses `console.warn`: `console.error` is wrapped, so an error about writing an error would
  // loop; the load line stays in memory and goes out with the next write.
  const flush = (line?: string): void => {
    queue = queue
      .then(async () => {
        const lines = pending === undefined ? [] : [pending];
        if (line !== undefined) lines.push(line);
        if (lines.length === 0) return;
        if (!desktop) await ensureJournalDir(app);
        await appendJournal(adapter, file, lines.map((item) => `${item}\n`).join(''));
        pending = undefined;
      })
      .catch((error: unknown) => console.warn(`Buba: error log not written (${file})`, error));
  };
  const write = (kind: Kind, text: string): void => flush(lineOf(kind, text));

  const report = (kind: Kind, text: string): void => {
    if (errors > MAX_ERRORS) return;
    errors += 1;
    if (errors <= MAX_ERRORS) write(kind, text);
    else write('limit', `limit of ${MAX_ERRORS} error lines per run reached, not writing more`);
  };

  if (desktop) flush();

  // Console wrapper: our line first, then the original `console.error`, always and with the same arguments.
  const previous = console.error;
  let active = true;
  const wrapper = (...args: unknown[]): void => {
    try {
      const [first] = args;
      if (active && typeof first === 'string' && first.startsWith(PREFIX)) {
        report('console', args.map(describe).join(' '));
      }
    } finally {
      Reflect.apply(previous, console, args);
    }
  };
  console.error = wrapper;

  const onError = (evt: Event): void => {
    const error: unknown = (evt as ErrorEvent).error;
    if (active && fromBuba(error)) report('error', describe(error));
  };
  const onRejection = (evt: Event): void => {
    const reason: unknown = (evt as PromiseRejectionEvent).reason;
    if (active && fromBuba(reason)) report('rejection', describe(reason));
  };

  // Obsidian windows: the main one, those already open and those opened later (`window-open`); closed ones
  // are released (`window-close`).
  const { workspace } = app;
  const attached = new Map<Window, () => void>();
  const attach = (win: Window): void => {
    if (attached.has(win)) return;
    win.addEventListener('error', onError);
    win.addEventListener('unhandledrejection', onRejection);
    attached.set(win, () => {
      win.removeEventListener('error', onError);
      win.removeEventListener('unhandledrejection', onRejection);
    });
  };
  attach(window);
  workspace.iterateAllLeaves((leaf) => attach(leaf.view.containerEl.win));
  plugin.registerEvent(workspace.on('window-open', (win) => attach(win.win)));
  plugin.registerEvent(
    workspace.on('window-close', (win) => {
      attached.get(win.win)?.();
      attached.delete(win.win);
    }),
  );

  plugin.register(() => {
    active = false;
    // If another plugin wrapped the console after us, leave its wrapper alone: ours stays a pass-through.
    if (console.error === wrapper) console.error = previous;
    for (const detach of attached.values()) detach();
    attached.clear();
  });
}
