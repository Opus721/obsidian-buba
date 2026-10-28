// Progress of a large batch move, like a file manager's copy dialog: a notice that stays while the batch runs,
// with "Moving k of n into …", a bar and a "Stop" button. Stop takes effect before the next move: what moved
// stays moved and is one undo step, the rest stays in place (`MoveWatch.stopped`, src/platform/files/move.ts).
// Batches under `BATCH_MIN` files end before a notice is worth showing and get none. The text and the bar
// change at most every `REDRAW_MS`, so a batch of thousands does not redraw the notice per file.
import { Notice } from 'obsidian';
import { t } from '../../core/i18n/dict/actions.ts';
import { BATCH_MIN } from '../../platform/files/batch.ts';
import type { MoveWatch } from '../../platform/files/move.ts';
import './move-progress.css';

const REDRAW_MS = 100;

/** The watch for a move into `folder` and `close`, which takes the notice down when the batch is over. */
export function moveProgress(folder: string): { watch: MoveWatch; close(): void } {
  let stop = false;
  let notice: Notice | null = null;
  let text: HTMLElement | null = null;
  let fill: HTMLElement | null = null;
  let drawn = 0;
  const open = (total: number) => {
    notice = new Notice(
      createFragment((el) => {
        const box = el.createDiv({ cls: 'buba-move-progress' });
        text = box.createDiv({ cls: 'buba-move-progress-text' });
        fill = box.createDiv({ cls: 'buba-move-progress-bar' }).createDiv({ cls: 'buba-move-progress-fill' });
        const button = box.createEl('button', { cls: 'buba-move-progress-stop', text: t('moveStop') });
        // A click on a notice hides it; the button only stops the batch, and the notice stays until the end.
        button.addEventListener('click', (evt) => {
          evt.stopPropagation();
          stop = true;
          button.disabled = true;
          button.setText(t('moveStopping'));
        });
      }),
      0,
    );
    draw(0, total);
  };
  const draw = (handled: number, total: number) => {
    drawn = performance.now();
    text?.setText(t('moving', { folder, handled, total }));
    fill?.setCssProps({ '--buba-move-done': `${(100 * handled) / total}%` });
  };
  return {
    watch: {
      progress(handled, total) {
        if (total < BATCH_MIN) return;
        if (!notice) open(total);
        else if (handled === total || performance.now() - drawn >= REDRAW_MS) draw(handled, total);
      },
      stopped: () => stop,
    },
    close() {
      notice?.hide();
    },
  };
}
