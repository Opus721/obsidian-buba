// Thin adapter between the file index and the Obsidian vault: fills the index after load, then follows
// events.
import { TFile, TFolder, type Plugin, type TAbstractFile } from 'obsidian';
import { FileIndex, recordOf } from './file-index.ts';

const indexes = new WeakMap<Plugin, FileIndex>();

/** Vault file index, one per plugin instance; unloading the plugin drops its subscriptions. */
export function vaultFileIndex(plugin: Plugin): FileIndex {
  const known = indexes.get(plugin);
  if (known) return known;
  const index = new FileIndex();
  indexes.set(plugin, index);
  const { vault, workspace } = plugin.app;
  const put = (file: TAbstractFile) => {
    if (file instanceof TFile) index.add(recordOf(file.path, file.stat));
    else if (file instanceof TFolder) index.addFolder(file.path);
  };
  // `create` also fires for every file while the vault loads, so subscribe after layout is ready.
  workspace.onLayoutReady(() => {
    index.batch(() => {
      vault.getAllLoadedFiles().forEach(put);
      index.markFilled();
    });
    plugin.registerEvent(vault.on('create', put));
    plugin.registerEvent(
      vault.on('modify', (file) => {
        if (file instanceof TFile) index.update(recordOf(file.path, file.stat));
      }),
    );
    plugin.registerEvent(
      vault.on('delete', (file) => {
        if (file instanceof TFolder) index.removeFolder(file.path);
        else index.remove(file.path);
      }),
    );
    plugin.registerEvent(
      vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile) index.rename(oldPath, recordOf(file.path, file.stat));
        else if (file instanceof TFolder) index.renameFolder(oldPath, file.path);
      }),
    );
  });
  return index;
}
