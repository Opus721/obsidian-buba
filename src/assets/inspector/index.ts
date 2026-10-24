// Buba file panel on the right, like the Eagle inspector, is an extension point: a module adds its own
// section. Inside `assets` that is `registerInspectorSection`; a module outside `assets` gets the function
// from the `buba:inspector-sections` workspace event, without an import, the way another module's action is
// called by command id.
import { Menu, Platform, TFile, type Events, type Plugin, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../core/i18n/dict/inspector.ts';
import { INSPECTOR_SECTIONS, INSPECTOR_SECTIONS_ASK, SHOW_PANEL } from '../../core/inspector/events.ts';
import { inDataDir } from '../../core/storage/types.ts';
import { FILE_PANEL } from '../../core/viewer/edge.ts';
import { ownTitle } from '../../platform/menu-title.ts';
import { onSettingsChange, settingsOf } from '../../platform/settings.ts';
import { MENU_SOURCE, TILE_MENU } from '../actions/file-menu.ts';
import type { BubaAssets } from '../api.ts';
import { boardsSection } from './boards-section.ts';
import { commentsSection } from './comments-section.ts';
import { fileSection } from './file-section.ts';
import { registerFollow, type PanelFollow } from './follow.ts';
import { linkSection } from './link-section.ts';
import { copyPathButton } from './path-copy.ts';
import { previewSections } from './preview-section.ts';
import { ratingSection } from './rating-section.ts';
import { SectionRegistry, type InspectorSection } from './sections.ts';
import { tagsSection } from './tags-section.ts';
import { INSPECTOR_VIEW_TYPE, InspectorView } from './view.ts';

const registries = new WeakMap<Plugin, SectionRegistry>();

function registryOf(plugin: Plugin): SectionRegistry {
  let registry = registries.get(plugin);
  if (!registry) {
    registry = new SectionRegistry();
    registries.set(plugin, registry);
  }
  return registry;
}

/**
 * The "File panel" view, the `buba:open-inspector` command, the "File panel" file menu item and the built-in
 * "File" section; what the panel shows is decided in `follow.ts`.
 */
export function registerInspector(plugin: Plugin, assets: BubaAssets): void {
  const { workspace } = plugin.app;
  const follow = registerFollow(plugin, assets);
  plugin.registerView(
    INSPECTOR_VIEW_TYPE,
    (leaf) => new InspectorView(leaf, registryOf(plugin), follow.paths),
  );
  plugin.addCommand({
    id: 'open-inspector',
    name: t('commandOpenPanel'),
    callback: () => void openInspector(plugin),
  });
  // On a phone a tile tap does not slide the panel out (`follow.ts`); the tile menu item does, listed first:
  // via the tile menu event before `file-menu`, in the `open` section where Obsidian's file explorer puts
  // "Open". On desktop the selection itself opens the panel, so the tile menu has no item.
  if (Platform.isMobile) {
    plugin.registerEvent(
      // Obsidian's types do not know our workspace events, so the workspace is used as `Events`.
      (workspace as Events).on(TILE_MENU, (menu, files) => {
        const file = Array.isArray(files) && files.length === 1 ? (files[0] as unknown) : null;
        if (menu instanceof Menu) addPanelItem(follow, menu, file, 'open');
      }),
    );
    // The viewer was closed by a swipe from the right edge: the panel slides out with the viewer's file the
    // same way as the "File panel" item, `ensureSideLeaf` with reveal (which calls `revealLeaf`); the grid is
    // left alone.
    plugin.registerEvent(
      (workspace as Events).on(FILE_PANEL, (file) => {
        if (isPanelFile(file)) showPanel(follow, file);
      }),
    );
  }
  // The menu of any other file (the open file's "⋯" `more-options`, a tab, the file explorer, search): the
  // item slides the panel out with that file and the open file stays open. No section, so it sits next to
  // "Add tag…".
  plugin.registerEvent(
    workspace.on('file-menu', (menu, file, source) => {
      if (source !== MENU_SOURCE) addPanelItem(follow, menu, file, null);
    }),
  );
  registerInspectorSection(
    plugin,
    fileSection(plugin.app, copyPathButton, () => settingsOf(plugin)),
  );
  for (const section of previewSections(plugin)) registerInspectorSection(plugin, section);
  registerInspectorSection(plugin, commentsSection(plugin));
  registerInspectorSection(plugin, tagsSection(plugin, assets, follow));
  registerInspectorSection(plugin, ratingSection(plugin));
  registerInspectorSection(plugin, linkSection(plugin));
  registerInspectorSection(plugin, boardsSection(plugin));
  // When "Date format" or "Time format" changes, an open panel redraws its dates at once; other settings do
  // not affect the panel.
  let dates = dateKey(settingsOf(plugin));
  plugin.register(
    onSettingsChange(plugin, (settings) => {
      const next = dateKey(settings);
      if (next === dates) return;
      dates = next;
      refreshInspectors(plugin);
    }),
  );
  // Another module shows a file in the panel at its own section ("Show generations" when deleting a
  // reference).
  plugin.registerEvent(
    (workspace as Events).on(SHOW_PANEL, (path, section) => {
      const file = typeof path === 'string' ? plugin.app.vault.getFileByPath(path) : null;
      if (!isPanelFile(file)) return;
      void follow
        .pick([file.path])
        .then(() => {
          if (typeof section === 'string') scrollToSection(plugin, section);
        })
        .catch((error: unknown) => console.error('Buba: file panel did not open', error));
    }),
  );
  const add = (section: InspectorSection): (() => void) => registerInspectorSection(plugin, section);
  // A module that started listening after the call below asks again; before the layout is ready the call
  // still reaches it, so the answer waits for the layout and a section is added once.
  plugin.registerEvent(
    (workspace as Events).on(INSPECTOR_SECTIONS_ASK, (receive) => {
      if (workspace.layoutReady && typeof receive === 'function') (receive as (add: unknown) => void)(add);
    }),
  );
  workspace.onLayoutReady(() => workspace.trigger(INSPECTOR_SECTIONS, add));
}

/** Adds a section to the panel; removed on plugin unload or by the returned function. */
export function registerInspectorSection(plugin: Plugin, section: InspectorSection): () => void {
  const cancel = registryOf(plugin).add(section);
  plugin.register(cancel);
  refreshInspectors(plugin);
  return () => {
    cancel();
    refreshInspectors(plugin);
  };
}

/**
 * The panel is for files only: not for folders or journals in Buba data folders (`__buba-data/`, legacy
 * `Buba/`).
 */
function isPanelFile(file: unknown): file is TFile {
  return file instanceof TFile && !inDataDir(file.path);
}

/** Slides the panel out with the file. */
function showPanel(follow: PanelFollow, file: TFile): void {
  follow.pick([file.path]).catch((error: unknown) => console.error('Buba: file panel did not open', error));
}

/** The "File panel" item is for files only: folders and Buba journals do not get it. */
function addPanelItem(follow: PanelFollow, menu: Menu, file: unknown, section: string | null): void {
  if (!isPanelFile(file)) return;
  menu.addItem((item) => {
    item
      .setTitle(ownTitle(t('menuOpenPanel')))
      .setIcon('info')
      .onClick(() => showPanel(follow, file));
    if (section) item.setSection(section);
  });
}

/** Scrolls open panels so the section starts at the top. */
function scrollToSection(plugin: Plugin, id: string): void {
  for (const leaf of plugin.app.workspace.getLeavesOfType(INSPECTOR_VIEW_TYPE)) {
    const el = leaf.view.containerEl.querySelector(`[data-section="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ block: 'start' });
  }
}

function openInspector(plugin: Plugin): Promise<WorkspaceLeaf> {
  return plugin.app.workspace.ensureSideLeaf(INSPECTOR_VIEW_TYPE, 'right', { reveal: true });
}

const dateKey = ({ dateFormat, timeFormat }: { dateFormat: string; timeFormat: string }): string =>
  `${dateFormat} ${timeFormat}`;

function refreshInspectors(plugin: Plugin): void {
  for (const leaf of plugin.app.workspace.getLeavesOfType(INSPECTOR_VIEW_TYPE)) {
    if (leaf.view instanceof InspectorView) leaf.view.refresh();
  }
}
