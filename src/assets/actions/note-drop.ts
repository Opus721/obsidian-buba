// Buba tiles dropped into an open note are inserted at the drop point as links per Obsidian's settings, like
// files from Obsidian's file tree. The hook is the public `editor-drop` event: "evt.preventDefault() — the
// event is handled" (`obsidian.d.ts`), so if another handler cancelled it first, we bail out. Links come from
// `generateMarkdownLink`, the text from the core rule `noteDropText`. Drop point and insertion use
// `@codemirror/view` (`EditorView.findFromDOM`, `posAtCoords`, `dispatch`), which `obsidian.d.ts` itself
// exposes to plugins and the build keeps external as an Obsidian module; the internal `editor.cm`,
// `posAtMouse` and `app.dragManager` are not used. Tiles from another vault and other drops are left to the
// editor, which receives them as `obsidian://open` lines (`setBubaDragData`).
import { EditorView } from '@codemirror/view';
import type { Plugin } from 'obsidian';
import { noteDropText, type NoteLink } from '../../core/actions/note-links.ts';
import { isOwnTileDrag, readBubaDragPaths } from '../../platform/canvas-drag.ts';
import type { BubaAssets } from '../api.ts';

export function registerNoteDrop(plugin: Plugin, _assets: BubaAssets): void {
  const { app } = plugin;
  plugin.registerEvent(
    app.workspace.on('editor-drop', (evt, editor, info) => {
      if (evt.defaultPrevented) return;
      const dt = evt.dataTransfer;
      const paths = readBubaDragPaths(dt);
      if (paths === null || !isOwnTileDrag(dt)) return;
      const source = info.file?.path ?? '';
      const links: NoteLink[] = [];
      for (const path of paths) {
        // Folders and files deleted during the drag are skipped, as in Obsidian's file tree.
        const file = app.vault.getFileByPath(path);
        if (!file) continue;
        links.push({ extension: file.extension, link: app.fileManager.generateMarkdownLink(file, source) });
      }
      evt.preventDefault();
      const text = noteDropText(links);
      if (!text) return;
      const view = dropView(evt);
      if (view) {
        // As Obsidian itself inserts: drop point and insertion use the same view, the one under the drop
        // point. A table cell being edited (Live Preview) has its own nested view with its own text: its
        // offset applied to the note's `editor` would put the link into another line.
        view.dispatch({ selection: { anchor: view.posAtCoords({ x: evt.clientX, y: evt.clientY }, false) } });
        view.dispatch(view.state.replaceSelection(text));
        view.focus();
        return;
      }
      const offset = editor.posToOffset(editor.getCursor());
      editor.replaceRange(text, editor.offsetToPos(offset));
      editor.setCursor(editor.offsetToPos(offset + text.length));
      editor.focus();
    }),
  );
}

/** The CodeMirror view under the drop point; `null` if none. */
function dropView(evt: DragEvent): EditorView | null {
  // `instanceof` does not work in popout windows, as with `tileOf` in tile-drag.ts.
  const el = evt.target as Element | null;
  const dom = typeof el?.closest === 'function' ? el.closest<HTMLElement>('.cm-editor') : null;
  return dom ? EditorView.findFromDOM(dom) : null;
}
