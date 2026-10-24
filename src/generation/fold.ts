// Collapsible heading of a generation section, like Obsidian's collapsed groups: a chevron and the title; a
// click folds the whole section. The state is one per device (`saveLocalStorage`), unfolded by default.
import { setIcon, type App } from 'obsidian';

export function isFolded(app: App, key: string): boolean {
  return app.loadLocalStorage(key) === true;
}

/**
 * Draws the heading; `aside` is shown after the title while folded (the model name). A click saves the state
 * and calls `toggled`, which redraws the section. `tools` draws buttons on the right of the heading, folded
 * or not, so they keep one place for every file.
 */
export function foldHeading(
  app: App,
  el: HTMLElement,
  key: string,
  title: string,
  aside: string | null,
  toggled: () => void,
  tools?: (head: HTMLElement) => void,
): boolean {
  const folded = isFolded(app, key);
  const head = el.createDiv({ cls: 'buba-gen-head' });
  const button = head.createEl('button', {
    cls: 'buba-gen-fold',
    attr: { type: 'button', 'aria-expanded': String(!folded) },
  });
  setIcon(button.createSpan({ cls: 'buba-gen-fold-icon' }), folded ? 'chevron-right' : 'chevron-down');
  button.createSpan({ cls: 'buba-gen-fold-title', text: title });
  if (folded && aside) button.createSpan({ cls: 'buba-gen-fold-aside', text: `· ${aside}` });
  button.addEventListener('click', () => {
    app.saveLocalStorage(key, !folded);
    toggled();
  });
  tools?.(head.createDiv({ cls: 'buba-gen-head-tools' }));
  return folded;
}
