// A collapsed tree row held under a drag expands, as in Obsidian's file explorer: it waits 750 ms under the
// same row and expands it only if the drag is still there (`mouseoverExpandTimeout`, app.js 1.14.4). Moving to
// another row restarts the wait; leaving the rows or ending the drag cancels it. One expander per tree.

/** Obsidian's wait before a collapsed folder under a drag expands. */
export const DRAG_EXPAND_MS = 750;

export interface DragExpander {
  /** A drag is over row `key`; `expand` runs after the wait if the row is collapsed and the drag stays. */
  over(win: Window, key: string, collapsed: boolean, expand: () => void): void;
  /** The drag left the rows or ended. */
  clear(): void;
}

export function dragExpander(): DragExpander {
  let key: string | null = null;
  let timer = 0;
  let timerWin: Window | null = null;
  const stop = (): void => {
    if (timer) timerWin?.clearTimeout(timer);
    timer = 0;
    timerWin = null;
  };
  return {
    over(win, next, collapsed, expand) {
      if (next === key && (timer || !collapsed)) return;
      stop();
      key = next;
      if (!collapsed) return;
      timerWin = win;
      timer = win.setTimeout(() => {
        timer = 0;
        timerWin = null;
        if (key === next) expand();
      }, DRAG_EXPAND_MS);
    },
    clear() {
      stop();
      key = null;
    },
  };
}
