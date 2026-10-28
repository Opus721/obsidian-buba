// File panel in the right sidebar: its own view, like the built-in "File properties" and "Backlinks". It
// shows what it is given (`showFiles`), and on open what the other views show (`initial`, follow.ts); it
// draws the registry sections in order. A rename, deletion or edit of a shown file redraws it; while a batch
// of moves runs, at the batch's calm pace and once more at its end (src/platform/files/batch.ts).
import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../core/i18n/dict/inspector.ts';
import { BATCH_FRAME_MS, batchRunning, onBatchEnd } from '../../platform/files/batch.ts';
import type { SectionRegistry } from './sections.ts';
import './inspector.css';

export const INSPECTOR_VIEW_TYPE = 'buba-inspector';

export class InspectorView extends ItemView {
  readonly #sections: SectionRegistry;
  readonly #initial: () => readonly string[];
  #paths: string[] = [];
  #cleanups: (() => void)[] = [];
  /** A redraw waiting for the calm pace of a running batch. */
  #paced = 0;

  constructor(leaf: WorkspaceLeaf, sections: SectionRegistry, initial: () => readonly string[] = () => []) {
    super(leaf);
    this.#sections = sections;
    this.#initial = initial;
  }

  override getViewType(): string {
    return INSPECTOR_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return t('panelTitle');
  }

  override getIcon(): string {
    return 'info';
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass('buba-inspector');
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (!this.#paths.includes(oldPath)) return;
        this.#paths = this.#paths.map((path) => (path === oldPath ? file.path : path));
        this.#changed();
      }),
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (!this.#paths.includes(file.path)) return;
        this.#paths = this.#paths.filter((path) => path !== file.path);
        this.#changed();
      }),
    );
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (this.#paths.includes(file.path)) this.#changed();
      }),
    );
    this.register(
      onBatchEnd(() => {
        if (this.#paced) this.#render();
      }),
    );
    this.#paths = this.#existing(this.#initial());
    this.#render();
  }

  override async onClose(): Promise<void> {
    window.clearTimeout(this.#paced);
    this.#paced = 0;
    this.#clean();
  }

  /** Shows files; paths without a file in the vault and duplicates are dropped. */
  showFiles(paths: readonly string[]): void {
    this.#paths = this.#existing(paths);
    this.#render();
  }

  /** What is shown, after the renames and deletions the panel has applied itself. */
  shownPaths(): string[] {
    return [...this.#paths];
  }

  /** Redraws the same files, e.g. when the set of sections changed. */
  refresh(): void {
    this.#render();
  }

  /** A shown file changed: redraw now, or at the calm pace while a batch runs. */
  #changed(): void {
    if (!batchRunning()) {
      this.#render();
      return;
    }
    if (this.#paced) return;
    this.#paced = window.setTimeout(() => this.#render(), BATCH_FRAME_MS);
  }

  #render(): void {
    window.clearTimeout(this.#paced);
    this.#paced = 0;
    this.#clean();
    this.contentEl.empty();
    if (!this.#paths.length) {
      this.contentEl.createDiv({ cls: 'pane-empty', text: t('selectFile') });
      return;
    }
    for (const section of this.#sections.list()) {
      const el = this.contentEl.createDiv({
        cls: 'buba-inspector-section',
        attr: { 'data-section': section.id },
      });
      // A section from another module that fails to render does not take the others down with it.
      try {
        const cleanup = section.render(el, [...this.#paths]);
        if (cleanup) this.#cleanups.push(cleanup);
      } catch (error) {
        console.error(`Buba: file panel section "${section.id}" did not render`, error);
      }
    }
  }

  #existing(paths: readonly string[]): string[] {
    return [...new Set(paths)].filter((path) => this.app.vault.getFileByPath(path) !== null);
  }

  #clean(): void {
    for (const cleanup of this.#cleanups.splice(0)) {
      try {
        cleanup();
      } catch (error) {
        console.error('Buba: file panel section cleanup failed', error);
      }
    }
  }
}
