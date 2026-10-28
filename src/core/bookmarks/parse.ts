// Obsidian's bookmarks (`<config dir>/bookmarks.json`, written by its core plugin Bookmarks) read for Buba's
// "Bookmarks" grid: files, folders and groups with their items. Searches and the graph have no public way to run them
// from a plugin; web links are left out too, since Buba opens addresses outside only from the file panel's link
// (a security rule). They stay in Obsidian's own bookmarks. A broken or unknown file is an empty list.

/** One bookmark Buba shows. `title` is the bookmark's own title, empty when it has none. */
export type Bookmark =
  | { kind: 'file'; path: string; subpath: string; title: string }
  | { kind: 'folder'; path: string; title: string }
  | { kind: 'group'; title: string; items: Bookmark[] };

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function item(raw: unknown): Bookmark | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;
  const title = text(data.title);
  switch (data.type) {
    case 'file': {
      const path = text(data.path);
      return path ? { kind: 'file', path, subpath: text(data.subpath), title } : null;
    }
    case 'folder': {
      const path = text(data.path);
      return path ? { kind: 'folder', path, title } : null;
    }
    case 'group':
      return { kind: 'group', title, items: list(data.items) };
    default:
      return null;
  }
}

function list(raw: unknown): Bookmark[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((each) => {
    const found = item(each);
    return found ? [found] : [];
  });
}

/** The bookmarks in the file's order; `json` is the file's text. */
export function parseBookmarks(json: string): Bookmark[] {
  try {
    const data: unknown = JSON.parse(json);
    return typeof data === 'object' && data !== null ? list((data as { items?: unknown }).items) : [];
  } catch {
    return [];
  }
}

/** The bookmarked files and folders, in the file's order, groups giving their items; each path once. */
export function bookmarkedPaths(items: readonly Bookmark[]): { files: string[]; folders: string[] } {
  const files = new Set<string>();
  const folders = new Set<string>();
  const walk = (list: readonly Bookmark[]): void => {
    for (const each of list) {
      if (each.kind === 'group') walk(each.items);
      else (each.kind === 'file' ? files : folders).add(each.path);
    }
  };
  walk(items);
  return { files: [...files], folders: [...folders] };
}
