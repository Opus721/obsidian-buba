// Undo with Ctrl+Z and redo with Ctrl+Shift+Z / Ctrl+Y for Buba actions, as in a file manager: every Buba
// action is a step, so Ctrl+Z takes the last one (src/core/actions/undo.ts). Moving tiles by dropping them on
// a tree folder, renaming, deleting files and folders, and creating (pasted copies, "Make a copy", new
// folders, notes, canvases and bases, added files) are undone; changes of tags, ratings, comments and looks
// are stops: Ctrl+Z says it can't undo them and the next press goes on (`stopOnChanges`). A step older than
// ten minutes, or undoing a create while Obsidian deletes permanently, asks first. As on Obsidian's canvas, the keys work in the grid body scope while it
// has focus (`view.scope`, src/assets/grid/view.ts) and while the "Grid keys" setting is on; in a note, in a
// field or without grid focus Ctrl+Z stays with Obsidian. The "Undo" and "Redo" commands have no default
// keys: a command key swallows the key press even when the command refuses (`executeCommand` returns `true`
// whatever `checkCallback` answers, app.js 1.14.4), so Ctrl+Z would stop undoing text in every note; users
// can assign their own keys under Hotkeys. On a phone there are items in the grid's "More" (⋮) menu, like
// "Undo" in the canvas menu. Actions run one at a time, in a queue. Deletion follows Obsidian's setting: a
// file comes back from Obsidian's trash but not from the system trash, and the notice says where it is;
// redoing a batch delete goes only through the "Delete files" dialog. Names are shown as text only.
import {
  ButtonComponent,
  ItemView,
  Keymap,
  Modal,
  Notice,
  Platform,
  type App,
  type Events,
  type Menu,
  type Plugin,
  type TAbstractFile,
  type TFile,
} from 'obsidian';
import {
  createdLines,
  nothingTo,
  keptIn,
  missedLine,
  outcomeHead,
  outcomeLines,
  stepTitle,
  trashLines,
  trashMissed,
  undoKey,
  type KeptStorage,
  type CreateStep,
  type Step,
  type SystemTrash,
  type TrashOutcome,
  type TrashStep,
  type UncreateStep,
  type UndoHistory,
} from '../../core/actions/undo.ts';
import { t } from '../../core/i18n/dict/actions.ts';
import { GRID_MENU } from '../../core/layout/grid-events.ts';
import { isTypingTarget } from '../../core/tags/keys.ts';
import { coreSetting } from '../../platform/core-settings.ts';
import { ownTitle } from '../../platform/menu-title.ts';
import {
  filesIn,
  recordFixed,
  recreateStep,
  redoStep,
  restoreStep,
  trashReady,
  trashSwept,
  uncreateStep,
  undoHistory,
  undoStep,
  viaPrompt,
  viaTrashFile,
  type StepRun,
} from '../../platform/files/undo.ts';
import { passportStorage } from '../../platform/passports.ts';
import { settingsOf } from '../../platform/settings.ts';
import type { BubaAssets } from '../api.ts';
import { confirmLinkUpdates } from './links-setting.ts';
import { confirmDeleteFiles, confirmDeleteFolders, referencesOf } from './menu-items.ts';

type Kind = 'undo' | 'redo';

/** How many reason lines the notice shows; the rest is a count. */
const SHOWN = 10;

export function registerUndo(plugin: Plugin, assets: BubaAssets): void {
  const { app } = plugin;
  const { workspace } = app;
  const history = undoHistory(app);
  stopOnChanges(plugin);

  // Queue: each action takes its step after the previous one ends, so quick Ctrl+Z presses do not overlap.
  let queue: Promise<void> = Promise.resolve();
  const run = (kind: Kind): Promise<void> => (queue = queue.then(() => act(plugin, history, kind)));

  for (const kind of ['undo', 'redo'] as const) {
    plugin.addCommand({
      id: kind,
      name: kind === 'undo' ? t('commandUndo') : t('commandRedo'),
      icon: kind === 'undo' ? 'undo-2' : 'redo-2',
      checkCallback: (checking) => {
        if (!peek(history, kind)) return false;
        if (!checking) void run(kind);
        return true;
      },
    });
  }

  // Keys: one `(null, null)` handler in the body scope of every grid, including ones
  // opened later. Not ours returns `undefined` and the scope goes on to T, 1–5 and space;
  // ours returns `false` and the key press is swallowed. The "Grid keys" setting is read
  // at key press time: when off, the key is not ours, while commands and ⋮ items stay.
  const wired = new WeakSet<object>();
  const install = (): void => {
    for (const view of assets.gridViews()) {
      const { scope } = view;
      if (!(view instanceof ItemView) || wired.has(view) || !scope) continue;
      wired.add(view);
      const handler = scope.register(null, null, (evt, ctx) => {
        const kind = undoKey({
          code: evt.code,
          vkey: ctx?.vkey,
          mod: Keymap.isModifier(evt, 'Mod'),
          ctrlKey: evt.ctrlKey,
          metaKey: evt.metaKey,
          altKey: evt.altKey,
          shiftKey: evt.shiftKey,
        });
        if (!kind || !settingsOf(plugin).gridKeys || isTypingTarget(evt.target as Element | null))
          return undefined;
        // A held key repeats: swallow it, but do not undo step after step.
        if (!evt.repeat) void run(kind);
        return false;
      });
      view.register(() => scope.unregister(handler));
    }
  };
  workspace.onLayoutReady(install);
  plugin.registerEvent(workspace.on('layout-change', install));

  // Phone: "Undo: …" and "Redo: …" in the grid's "More" menu, only when there is something to undo or redo.
  plugin.registerEvent(
    (workspace as Events).on(GRID_MENU, (...data: unknown[]) => {
      const [menu, target] = data as [Menu, unknown];
      if (!Platform.isPhone || !assets.gridViews().some((view) => (view as unknown) === target)) return;
      for (const kind of ['undo', 'redo'] as const) {
        const step = peek(history, kind);
        if (!step) continue;
        menu.addItem((item) =>
          item
            .setSection('action-primary')
            .setTitle(ownTitle(t(kind === 'undo' ? 'undoItem' : 'redoItem', { step: stepTitle(step) })))
            .setIcon(kind === 'undo' ? 'undo-2' : 'redo-2')
            .onClick(() => void run(kind)),
        );
      }
    }),
  );
}

/**
 * Storage calls a user makes to change tags, ratings, comments, links and the looks of folders and tags. Buba
 * cannot undo them yet, so each is a stop on the undo stack (`recordFixed`); vault events that carry records
 * along go through other calls and are not stops.
 */
const FIXED = [
  'addTags',
  'removeTags',
  'setRating',
  'addComment',
  'removeComment',
  'setCommentDone',
  'setLink',
  'setTagColor',
  'setGroupColor',
  'setGroupExclusive',
  'setTagDeclared',
  'deleteTag',
  'setFolderColor',
  'setFolderIcon',
  'setFolderCover',
  'setFolderFrame',
] as const;

/** Wraps the storage's change calls so each records a stop; unloading the plugin puts the calls back. */
function stopOnChanges(plugin: Plugin): void {
  const storage = (plugin as Plugin & { storage?: Record<string, unknown> }).storage;
  if (!storage) return;
  const own = new Map<string, unknown>();
  for (const name of FIXED) {
    const call = storage[name];
    if (typeof call !== 'function') continue;
    own.set(name, Object.prototype.hasOwnProperty.call(storage, name) ? call : undefined);
    storage[name] = (...args: unknown[]): unknown => {
      const result: unknown = call.apply(storage, args);
      recordFixed(plugin.app);
      return result;
    };
  }
  plugin.register(() => {
    for (const [name, call] of own) {
      if (call === undefined) delete storage[name];
      else storage[name] = call;
    }
  });
}

function peek(history: UndoHistory, kind: Kind): Step | null {
  return kind === 'undo' ? history.peekUndo() : history.peekRedo();
}

/**
 * One queued action: the top step → the links dialog, as before a drop move (dismissed: the step stays on the
 * stack) → take the step → moves with checks → what was done goes to the other stack → notice. Deletion has
 * its own path (`undoTrash`, `redoTrash`).
 */
async function act(plugin: Plugin, history: UndoHistory, kind: Kind): Promise<void> {
  const { app } = plugin;
  const step = peek(history, kind);
  if (!step) {
    new Notice(nothingTo(kind));
    return;
  }
  if (step.kind === 'fixed') {
    // A stop is only on the undo stack: said once and taken off, so the next press goes on.
    if (history.takeUndo(step)) new Notice(t('cannotUndo'), 10000);
    return;
  }
  if (kind === 'undo' && !(await confirmUndo(app, step))) return;
  if (step.kind === 'create' || step.kind === 'uncreate') {
    try {
      if (step.kind === 'create') await undoCreate(plugin, history, step);
      else await redoCreate(plugin, history, step);
    } catch (error) {
      console.error(`Buba: ${kind} of creation failed`, error);
      new Notice(kind === 'undo' ? t('undoFailed') : t('redoFailed'));
    }
    return;
  }
  if (step.kind === 'trash') {
    try {
      await (kind === 'undo' ? undoTrash(plugin, history, step) : redoTrash(plugin, history, step));
    } catch (error) {
      console.error(`Buba: ${kind} of deletion failed`, error);
      new Notice(kind === 'undo' ? t('undoFailed') : t('redoFailed'));
    }
    return;
  }
  try {
    const sources = step.ops.map(({ from, to }) => (kind === 'undo' ? to : from));
    if (!(await confirmLinkUpdates(app, sources))) return;
    if (!(kind === 'undo' ? history.takeUndo(step) : history.takeRedo(step))) return;
    const done = kind === 'undo' ? await undoStep(app, step) : await redoStep(app, step);
    if (kind === 'undo') history.undone(done.step);
    else history.redone(done.step);
    notice(kind, step, done);
  } catch (error) {
    console.error(`Buba: ${kind} failed`, error);
    new Notice(kind === 'undo' ? t('undoFailedJournal') : t('redoFailedJournal'));
  }
}

/**
 * Asks before undoing a create step while Obsidian deletes permanently: it cannot be brought back. `true`
 * means go on.
 */
function confirmUndo(app: App, step: Step): Promise<boolean> {
  if (step.kind !== 'create' || coreSetting(app, 'trashOption') !== 'none') return Promise.resolve(true);
  const lines = [t('foreverStepBody', { setting: t('deletedFilesSetting') })];
  const heading = t('foreverStepTitle', { step: stepTitle(step) });
  return new Promise((done) => new ConfirmUndoModal(app, heading, lines, done).open());
}

/**
 * "Undo: …?": why it cannot be brought back, then "Don't undo" and "Undo", laid out as Obsidian's
 * confirmation dialog (`mod-confirmation`, Cancel with `mod-cancel`). Close and Esc do not undo.
 */
class ConfirmUndoModal extends Modal {
  readonly #title: string;
  readonly #lines: readonly string[];
  readonly #done: (go: boolean) => void;
  #go = false;
  #buttons: HTMLElement | null = null;

  constructor(app: App, title: string, lines: readonly string[], done: (go: boolean) => void) {
    super(app);
    this.#title = title;
    this.#lines = lines;
    this.#done = done;
    this.containerEl.addClass('mod-confirmation');
  }

  override onOpen(): void {
    this.setTitle(this.#title);
    for (const line of this.#lines) this.contentEl.createEl('p', { text: line });
    const buttons = (this.#buttons = this.modalEl.createDiv({ cls: 'modal-button-container' }));
    new ButtonComponent(buttons)
      .setButtonText(t('dontUndo'))
      .setClass('mod-cancel')
      .onClick(() => this.close());
    new ButtonComponent(buttons)
      .setButtonText(t('undoButton'))
      .setCta()
      .onClick(() => {
        this.#go = true;
        this.close();
      });
  }

  override onClose(): void {
    this.contentEl.empty();
    this.#buttons?.remove();
    this.#buttons = null;
    this.#done(this.#go);
  }
}

/**
 * Undoing a create: take the step → what is still as Buba made it goes to the trash by the Obsidian setting
 * → that goes to redo → notice of what was undone and what stays and why.
 */
async function undoCreate(plugin: Plugin, history: UndoHistory, step: CreateStep): Promise<void> {
  if (!history.takeUndo(step)) return;
  const run = await uncreateStep(plugin.app, step, coreSetting(plugin.app, 'trashOption'));
  history.undone(run.step);
  show(outcomeHead('undo', step, run), null, createdLines(run.skipped, run.failed));
}

/** Redoing a create: bring back from Obsidian's trash what the undo put there, as when undoing a delete. */
async function redoCreate(plugin: Plugin, history: UndoHistory, step: UncreateStep): Promise<void> {
  if (!history.takeRedo(step)) return;
  const run = await recreateStep(plugin.app, step, keptIn(storageOf(plugin)));
  history.redone(run.step);
  const missed = trashMissed(run);
  show(
    outcomeHead('redo', step, run),
    missed ? missedLine('redo', missed) : null,
    trashLines('undo', run, systemTrash()),
  );
}

/**
 * Undoing a delete: take the step → restore from Obsidian's trash (`restoreStep`; tag records come from
 * plugin storage, so an untagged copy does not come back ahead of its tagged twin) → restored files go to
 * redo → notice of what came back, what did not and where it is. No links dialog: deletion does not change
 * links, and the restored file gets them back.
 */
async function undoTrash(plugin: Plugin, history: UndoHistory, step: TrashStep): Promise<void> {
  if (!history.takeUndo(step)) return;
  const run = await restoreStep(plugin.app, step, keptIn(storageOf(plugin)));
  history.undone(run.step);
  trashNotice('undo', step, run);
}

/**
 * Redoing a delete: only files still in their old place as the same file are deleted; a
 * batch only through the "Delete files" dialog with the file count and the trash line
 * per the setting at redo time, a single file through Obsidian's dialog, as on the first
 * delete; a reference of generations through the dialog that names them. If the dialog is
 * dismissed nothing is deleted and the step stays in redo.
 */
async function redoTrash(plugin: Plugin, history: UndoHistory, step: TrashStep): Promise<void> {
  const { app } = plugin;
  const { files, skipped } = trashReady(app, step);
  const passports = passportStorage(plugin);
  // A step deletes either files or folders; for folders the dialogs count the files inside.
  const folders = files.filter((file) => 'children' in file);
  const inside = folders.length ? (folders.flatMap(filesIn) as unknown as TFile[]) : (files as TFile[]);
  const ours = files.length > 1 || referencesOf(inside, passports).length > 0;
  if (ours && !(await confirmRedoDelete(app, files, folders, inside, passports))) return;
  if (!history.takeRedo(step)) return;
  const run = await trashSwept(
    app,
    files,
    coreSetting(app, 'trashOption'),
    ours ? viaTrashFile(app) : viaPrompt(app),
  );
  if (files.length === 1 && !run.ops.length && !run.failed.length) {
    history.undone(step);
    return;
  }
  history.redone({ kind: 'trash', ops: run.ops });
  trashNotice('redo', step, { done: run.ops.length, skipped, failed: run.failed, elsewhere: [], unseen: 0 });
}

/** The redo dialog: the folders dialog with their file count, or the files dialog. */
function confirmRedoDelete(
  app: App,
  files: readonly TAbstractFile[],
  folders: readonly TAbstractFile[],
  inside: readonly TFile[],
  passports: ReturnType<typeof passportStorage>,
): Promise<boolean> {
  return folders.length
    ? confirmDeleteFolders(app, folders.length, inside, passports)
    : confirmDeleteFiles(app, files as TFile[], passports);
}

/** Tag storage is the plugin's `storage` field, read as the tags module does; `undefined` until it opens. */
function storageOf(plugin: Plugin): KeptStorage | undefined {
  return (plugin as Plugin & { storage?: KeptStorage }).storage;
}

/** Where to look for the file in this device's system trash. */
function systemTrash(): SystemTrash {
  if (Platform.isIosApp) return 'ios';
  if (Platform.isWin) return 'windows';
  return Platform.isMacOS ? 'mac' : 'other';
}

/** Result as a notice: what was undone or redone, then what was not done and why. */
function notice(kind: Kind, step: Step, done: StepRun): void {
  const lines = outcomeLines(done);
  show(outcomeHead(kind, step, done), lines.length ? missedLine(kind, lines.length) : null, lines);
}

function trashNotice(kind: Kind, step: Step, outcome: TrashOutcome): void {
  const missed = trashMissed(outcome);
  show(
    outcomeHead(kind, step, outcome),
    missed ? missedLine(kind, missed) : null,
    trashLines(kind, outcome, systemTrash()),
  );
}

/** First line, the count of what was not done, and reasons up to `SHOWN`; the rest as a count. */
function show(head: string, missed: string | null, lines: readonly string[]): void {
  const message = createFragment((el) => {
    el.createDiv({ text: head });
    if (missed) el.createDiv({ text: missed });
    for (const line of lines.slice(0, SHOWN)) el.createDiv({ text: line });
    if (lines.length > SHOWN) el.createDiv({ text: t('andMore', { count: lines.length - SHOWN }) });
  });
  new Notice(message, lines.length ? 15000 : undefined);
}
