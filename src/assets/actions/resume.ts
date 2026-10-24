// A batch move left unfinished after a crash is offered at startup to finish or leave,
// based on this device's action log checked against the disk (`unfinishedMoves`,
// src/platform/files/move.ts), like Image Shelf's "planned → done" log. The dialog is
// a `Modal`, as in src/assets/actions/links-setting.ts; names are shown as text only.
import { ButtonComponent, Modal, Notice, type App, type Plugin } from 'obsidian';
import type { SkipReason } from '../../core/actions/move-plan.ts';
import { t } from '../../core/i18n/dict/actions.ts';
import {
  finishMoves,
  leaveMoves,
  unfinishedMoves,
  type MoveResult,
  type UnfinishedMoves,
} from '../../platform/files/move.ts';

type Choice = 'finish' | 'leave';
type Op = { from: string; to: string };

/** How many name lines the dialog and the notice show; the rest is a count. */
const SHOWN = 10;

/**
 * Called by `registerTreeDrop`: after layout is ready, one dialog for all unfinished batches of this device.
 */
export function registerResume(plugin: Plugin): void {
  plugin.app.workspace.onLayoutReady(() => void resume(plugin.app));
}

/** A dismissed dialog writes nothing, so Buba asks again on the next start. */
async function resume(app: App): Promise<void> {
  try {
    const batches = await unfinishedMoves(app);
    const ops = batches.flatMap((batch: UnfinishedMoves) => batch.ops);
    if (ops.length === 0) return;
    const choice = await new Promise<Choice | null>((done) => new ResumeModal(app, ops, done).open());
    if (choice === 'leave') {
      for (const { batch } of batches) await leaveMoves(app, batch);
    } else if (choice === 'finish') {
      const total: MoveResult = { moved: [], skipped: [], failed: [] };
      for (const { batch } of batches) {
        const { moved, skipped, failed } = await finishMoves(app, batch);
        total.moved.push(...moved);
        total.skipped.push(...skipped);
        total.failed.push(...failed);
      }
      moveNotice(
        total.moved.length ? t('moveFinished', { count: total.moved.length }) : t('moveNotFinished'),
        total,
      );
    }
  } catch (error) {
    console.error('Buba: unfinished move', error);
    new Notice(t('resumeFailed'));
  }
}

/** Batch result as a notice: `head` on the first line, then what was not moved and why. */
export function moveNotice(head: string, { skipped, failed }: MoveResult): void {
  const not = [
    ...skipped.map(({ path, why }) => t('nameReason', { name: nameOf(path), reason: reasonText(why) })),
    ...failed.map(({ from, error }) => t('nameReason', { name: nameOf(from), reason: reasonText(error) })),
  ];
  const message = createFragment((el) => {
    el.createDiv({ text: head });
    if (not.length) el.createDiv({ text: t('notMoved', { count: not.length }) });
    for (const line of not.slice(0, SHOWN)) el.createDiv({ text: line });
    if (not.length > SHOWN) el.createDiv({ text: t('andMore', { count: not.length - SHOWN }) });
  });
  new Notice(message, not.length ? 15000 : undefined);
}

const REASON = {
  missing: 'skipMissing',
  'same-folder': 'skipSameFolder',
  'into-itself': 'skipIntoItself',
  taken: 'skipTaken',
} as const satisfies Record<SkipReason, string>;

/** The reason in words: move plan codes from the dictionary, an Obsidian refusal as its text. */
function reasonText(why: string): string {
  return Object.hasOwn(REASON, why) ? t(REASON[why as SkipReason]) : why;
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * From and to as paths; "Finish" is the main button, "Leave" the refusal (`mod-cancel`, as in Obsidian's
 * confirmation dialog: at the bottom on a phone). Resolves to the choice, `null` when dismissed. The dialog
 * opens by itself when Buba loads and both buttons write, so no button has focus on open: an Enter meant for
 * another window must not decide for the user.
 */
class ResumeModal extends Modal {
  readonly #ops: readonly Op[];
  readonly #done: (choice: Choice | null) => void;
  #choice: Choice | null = null;
  #buttons: HTMLElement | null = null;

  constructor(app: App, ops: readonly Op[], done: (choice: Choice | null) => void) {
    super(app);
    this.#ops = ops;
    this.#done = done;
  }

  // With a physical keyboard Obsidian 1.12–1.14 focuses the first button right after `onOpen`, in `open()`.
  override open(): void {
    super.open();
    const focused = this.modalEl.doc.activeElement as HTMLElement | SVGElement | null;
    if (focused && this.modalEl.contains(focused)) focused.blur();
  }

  override onOpen(): void {
    this.setTitle(t('resumeTitle', { count: this.#ops.length }));
    this.contentEl.createEl('p', {
      text: t('resumeInterrupted'),
    });
    const list = this.contentEl.createEl('ul');
    for (const { from, to } of this.#ops.slice(0, SHOWN)) list.createEl('li', { text: `${from} → ${to}` });
    if (this.#ops.length > SHOWN)
      this.contentEl.createEl('p', { text: t('andMore', { count: this.#ops.length - SHOWN }) });
    this.contentEl.createEl('p', {
      text: t('resumeHint'),
    });
    const buttons = (this.#buttons = this.modalEl.createDiv({ cls: 'modal-button-container' }));
    new ButtonComponent(buttons)
      .setButtonText(t('finish'))
      .setCta()
      .onClick(() => this.#choose('finish'));
    new ButtonComponent(buttons)
      .setButtonText(t('leave'))
      .setClass('mod-cancel')
      .onClick(() => this.#choose('leave'));
  }

  override onClose(): void {
    this.contentEl.empty();
    this.#buttons?.remove();
    this.#buttons = null;
    this.#done(this.#choice);
  }

  #choose(choice: Choice): void {
    this.#choice = choice;
    this.close();
  }
}
