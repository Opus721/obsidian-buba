// A batch of disk actions in progress (a move of many files): every file is its own vault event, and a view
// that redraws on each frame of them spent five times longer than Obsidian's own moves (3,900 files: 162 s
// against 28 s, measured in Obsidian 1.14.4). While a batch runs such views redraw at a calm pace and once
// more when it ends. One counter for all windows: they share this script.

/** Batches of at least this many actions set the calm pace. */
export const BATCH_MIN = 50;
/** Redraw pace while a batch runs, ms. */
export const BATCH_FRAME_MS = 500;

let running = 0;
const ends = new Set<() => void>();

/** Whether a batch is running now. */
export function batchRunning(): boolean {
  return running > 0;
}

/** Runs `task` as a batch of `size` actions: a small one runs as is. Listeners hear the end of the last one. */
export async function inBatch<T>(size: number, task: () => Promise<T>): Promise<T> {
  if (size < BATCH_MIN) return task();
  running += 1;
  try {
    return await task();
  } finally {
    running -= 1;
    if (running === 0)
      for (const end of [...ends]) {
        try {
          end();
        } catch (error) {
          console.error('Buba: batch end listener failed', error);
        }
      }
  }
}

/** Calls `listener` when no batch runs any more; returns the unsubscribe call. */
export function onBatchEnd(listener: () => void): () => void {
  ends.add(listener);
  return () => {
    ends.delete(listener);
  };
}
