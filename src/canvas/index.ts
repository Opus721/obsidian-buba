// Canvas module: a bridge to Obsidian's built-in canvas that accepts Buba tiles dropped onto an open canvas
// (src/canvas/drop.ts). Listens on the document of every Obsidian window: main, already open and new.
import type { Plugin } from 'obsidian';
import { canvasDrop } from './drop.ts';

export function registerCanvasModule(plugin: Plugin): void {
  const { workspace } = plugin.app;
  const { dragover, drop } = canvasDrop(plugin.app);
  const attached = new WeakSet<Document>();
  const attach = (doc: Document): void => {
    if (attached.has(doc)) return;
    attached.add(doc);
    // Capture phase: the document hears the drop before the canvas, which would turn it into a text card.
    plugin.registerDomEvent(doc, 'dragover', dragover, { capture: true });
    plugin.registerDomEvent(doc, 'drop', drop, { capture: true });
  };
  attach(document);
  workspace.iterateAllLeaves((leaf) => attach(leaf.view.containerEl.doc));
  plugin.registerEvent(workspace.on('window-open', (win) => attach(win.doc)));
}
