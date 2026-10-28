// Group and tag menus in "All tags": an Obsidian `Menu` on right-click, or on long press on phones (row
// listener in src/platform/row-menus.ts); the row stays highlighted while the menu is open. Group: "New
// tag in group…", "Exclusive" (with a confirmation if files have several of its tags), "Rename group…",
// "Color…" and, below a separator in red, "Delete group…": its tags go with it, as a folder's files go with the
// folder. Tag: "Rename…", "Move to group…", "Remove from group", "Color…" and, below a separator in red,
// "Delete tag…" with a file count confirmation; sections `action` and `danger`, as in Obsidian's file menu.
// Moving is `renameTag` to `groupedName`; color uses the color dialog, with pinned colors in storage. A tag
// lives until deleted: a new tag is a declaration without files, and deletion removes it from all files plus
// its declaration and color in one write. Dialog counts and "New tag" names follow the "All tags" list
// (listed.ts); plans and writes go over all index records. Several tags picked with Ctrl and Shift get their
// own menu (`showTagsMenu`): move, color and delete for all of them, each with one confirmation.
import { Menu, Notice, type App } from 'obsidian';
import type { ColorValue } from '../../core/color/value.ts';
import { t } from '../../core/i18n/dict/tags.ts';
import { tagKey, type TagStorage } from '../../core/storage/types.ts';
import {
  mergeConflicts,
  moveChoices,
  pinnedColorsOf,
  planNewTag,
  planRenameGroup,
  tagGroups,
  type GroupInfo,
  type MoveChoice,
} from '../../core/tags/group-plan.ts';
import { groupedName, tagGroup } from '../../core/tags/groups.ts';
import { planRename, renameGroup, renameTag } from '../../core/tags/rename.ts';
import { openColorPicker } from '../color/picker.ts';
import { showRowMenu, type MenuAt } from '../../platform/row-menus.ts';
import { ConfirmModal, GroupPickModal, MoveChoiceModal, NameModal } from './group-modals.ts';
import { listedFiles, listedTags } from './listed.ts';
import { openRenameTag } from './rename.ts';

/**
 * Whether a file exists in the vault. Storage keeps records of missing files, but confirmation dialog counts
 * include only existing files, like the tree and grid tiles; without this check every record counts.
 */
export type Exists = (path: string) => boolean;

const anyRecord: Exists = () => true;

/**
 * A storage write; on failure a `failed` notice in Buba's language, details in English to the console
 * (`log`).
 */
async function write(run: () => Promise<unknown>, failed: string, log: string): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (error) {
    console.error(`Buba: ${log}`, error);
    new Notice(failed);
    return false;
  }
}

/**
 * Color dialog for a tag or group: the current color, pinned colors from storage. Each pick is written to
 * storage at once and the dialog stays open; storage skips an unchanged value, and writes run in order.
 */
function pickColor(
  app: App,
  storage: TagStorage,
  title: string,
  value: ColorValue | null,
  set: (value: ColorValue | null) => Promise<void>,
): void {
  openColorPicker(app, {
    title,
    value,
    pinned: pinnedColorsOf(storage),
    onPick: (chosen) => void write(() => set(chosen), t('colorFailed'), 'color not set'),
  });
}

/** Menu of a group row. */
export function showGroupMenu(
  app: App,
  storage: TagStorage,
  group: string,
  at: MenuAt,
  exists: Exists = anyRecord,
): Menu {
  const { exclusive, color } = storage.groupSettings(group);
  const menu = new Menu();
  menu.addItem((item) =>
    item
      .setSection('action')
      .setTitle(t('menuNewTagInGroup'))
      .setIcon('plus')
      .onClick(() => openNewTag(app, storage, group)),
  );
  menu.addItem((item) =>
    item
      .setSection('action')
      .setTitle(t('exclusive'))
      .setIcon('lucide-split')
      .setChecked(exclusive)
      .onClick(() => setExclusive(app, storage, group, !exclusive, exists)),
  );
  menu.addItem((item) =>
    item
      .setSection('action')
      .setTitle(t('menuRenameGroup'))
      .setIcon('pencil')
      .onClick(() => openRenameGroup(app, storage, group, exists)),
  );
  menu.addItem((item) =>
    item
      .setSection('action')
      .setTitle(t('menuColor'))
      .setIcon('palette')
      .onClick(() =>
        pickColor(app, storage, t('groupColor', { group }), color, (value) =>
          storage.setGroupColor(group, value),
        ),
      ),
  );
  menu.addItem((item) =>
    item
      .setSection('danger')
      .setTitle(t('menuDeleteGroup'))
      .setIcon('trash-2')
      .setWarning(true)
      .onClick(() => askDeleteGroup(app, storage, group, exists)),
  );
  return showRowMenu(menu, at);
}

/**
 * Group flag. Turning it on for a group where files have several of its tags asks for confirmation with their
 * count: the last one set stays, the rest are hidden (turning it off brings them back; the journal is
 * untouched).
 */
function setExclusive(app: App, storage: TagStorage, group: string, on: boolean, exists: Exists): void {
  const run = () =>
    void write(
      () => storage.setGroupExclusive(group, on),
      t('exclusiveFailed'),
      'group exclusive flag not set',
    );
  const overlaps = on ? storage.groupOverlaps(group).filter(exists).length : 0;
  if (!overlaps) return run();
  new ConfirmModal(
    app,
    t('exclusiveGroup', { group }),
    [t('exclusiveOverlaps', { count: overlaps }), t('exclusiveUndo')],
    t('turnOn'),
    run,
  ).open();
}

/**
 * New group name; the name of an existing group asks to confirm a merge: tags merge and that group's flag and
 * color stay. For an exclusive target, a line says on how many files its tag will be removed
 * (`mergeConflicts`), as when moving a tag. Merge vs. rename is decided over all index records
 * (`planRenameGroup`), the group's tag count by the "All tags" list: a group whose tags remain only on
 * deleted files exists but has no tags in the list.
 */
function openRenameGroup(app: App, storage: TagStorage, group: string, exists: Exists): void {
  new NameModal(app, t('renameGroup'), group, t('rename'), (text) => {
    const plan = planRenameGroup(group, text, storage.allTags());
    if (plan.kind === 'refuse') {
      new Notice(plan.reason);
      return false;
    }
    const run = () => void renameGroupNow(app, storage, group, plan.to);
    if (plan.kind !== 'merge') {
      run();
      return true;
    }
    const target = tagKey(plan.to);
    const tags = tagGroups(listedTags(app, storage)).find(({ key }) => key === target)?.tags ?? 0;
    const names = { to: plan.to, from: group };
    const merge = tags ? t('mergeGroupHasTags', { ...names, count: tags }) : t('mergeGroupNoTags', names);
    const lines = [merge, t('mergeGroupKeeps')];
    const conflicts = mergeConflicts(storage, group, plan.to).filter(exists).length;
    if (conflicts) lines.push(t('exclusiveLoses', { group: plan.to, count: conflicts }));
    new ConfirmModal(app, t('mergeGroups'), lines, t('merge'), run).open();
    return true;
  }).open();
}

/**
 * The notice's tag count follows the "All tags" list before the write, as in the merge dialog; the write
 * covers all.
 */
async function renameGroupNow(app: App, storage: TagStorage, from: string, to: string): Promise<void> {
  const source = tagKey(from);
  const n = tagGroups(listedTags(app, storage)).find(({ key }) => key === source)?.tags ?? 0;
  const failed = t('renameGroupFailed', { group: from });
  if (!(await write(() => renameGroup(storage, from, to), failed, 'group not renamed'))) return;
  new Notice(t('renamedGroup', { from, to, count: n }));
}

/**
 * "New tag": a name dialog; inside group `group` the short name is typed. The name is checked by `planNewTag`
 * against the "All tags" list, so "already exists" is refused only for a visible tag; a legacy tag left only
 * on deleted files is re-declared this way with its old color. A refusal shows a notice and the dialog stays.
 * Creating declares the tag without files: it appears in the list with count 0 and lives until deleted.
 * `value` prefills the field, e.g. with text typed in the list search.
 */
export function openNewTag(app: App, storage: TagStorage, group: string | null, value = ''): void {
  const title = group === null ? t('newTag') : t('newTagInGroup', { group });
  new NameModal(
    app,
    title,
    value,
    t('create'),
    (text) => {
      const plan = planNewTag(text, group, listedTags(app, storage));
      if (plan.kind === 'refuse') {
        new Notice(plan.reason);
        return false;
      }
      void createTag(app, storage, plan.tag);
      return true;
    },
    t('name'),
  ).open();
}

/**
 * Workspace event after a tag is created (the tag as data): the tag list shows it as the tree shows a new
 * folder, selected, its group expanded and the row scrolled into view (word of the owner 28.10 08:31).
 */
export const TAG_CREATED = 'buba:tag-created';

async function createTag(app: App, storage: TagStorage, tag: string): Promise<void> {
  if (!(await write(() => storage.setTagDeclared(tag, true), t('createFailed', { tag }), 'tag not created')))
    return;
  new Notice(t('created', { tag }));
  app.workspace.trigger(TAG_CREATED, tag);
}

/**
 * Menu of a tag row; "Remove from group" only for a tag in a group. "Delete tag…" is in the `danger` section,
 * like "Delete" in Obsidian's file menu: last, below a separator (Obsidian draws separators between sections
 * itself).
 */
export function showTagMenu(
  app: App,
  storage: TagStorage,
  tag: string,
  at: MenuAt,
  exists: Exists = anyRecord,
): Menu {
  const group = tagGroup(tag);
  const menu = new Menu();
  menu.addItem((item) =>
    item
      .setSection('action')
      .setTitle(t('menuRename'))
      .setIcon('pencil')
      .onClick(() => openRenameTag(app, storage, tag)),
  );
  menu.addItem((item) =>
    item
      .setSection('action')
      .setTitle(t('menuMoveToGroup'))
      .setIcon('folder-input')
      .onClick(() =>
        new GroupPickModal(app, groupsToPick(app, storage), group, (into) =>
          moveTag(app, storage, tag, into, exists),
        ).open(),
      ),
  );
  if (group !== null)
    menu.addItem((item) =>
      item
        .setSection('action')
        .setTitle(t('removeFromGroup'))
        .setIcon('folder-output')
        .onClick(() => moveTag(app, storage, tag, null, exists)),
    );
  menu.addItem((item) =>
    item
      .setSection('action')
      .setTitle(t('menuColor'))
      .setIcon('palette')
      .onClick(() =>
        pickColor(app, storage, t('tagColor', { tag }), storage.tagColor(tag), (value) =>
          storage.setTagColor(tag, value),
        ),
      ),
  );
  menu.addItem((item) =>
    item
      .setSection('danger')
      .setTitle(t('menuDeleteTag'))
      .setIcon('trash-2')
      .setWarning(true)
      .onClick(() => askDeleteTag(app, storage, tag, exists)),
  );
  return showRowMenu(menu, at);
}

/**
 * "Delete tag…": confirmation with the number of existing files, as Obsidian's delete dialog, with a red
 * button. For a visible tag of an exclusive group, a line says on how many files the group's hidden tags go
 * too (removing the visible tag takes the hidden ones with it). Deletion is one storage write: removal from
 * all records, the declaration and the color.
 */
export function askDeleteTag(app: App, storage: TagStorage, tag: string, exists: Exists): void {
  const paths = storage.filesWithTag(tag).filter(exists);
  const n = paths.length;
  const lines = [n ? t('deleteFrom', { count: n }) : t('deleteNoFiles')];
  const group = tagGroup(tag);
  if (group !== null && storage.groupSettings(group).exclusive) {
    const overlaps = new Set(storage.groupOverlaps(group));
    const hidden = paths.filter((path) => overlaps.has(path)).length;
    if (hidden) lines.push(t('deleteHidden', { group, count: hidden }));
  }
  lines.push(t('deleteGone'));
  new ConfirmModal(
    app,
    t('deleteTag', { tag }),
    lines,
    t('delete'),
    () => void deleteNow(storage, tag, n),
    true,
  ).open();
}

async function deleteNow(storage: TagStorage, tag: string, n: number): Promise<void> {
  if (!(await write(() => storage.deleteTag(tag), t('deleteFailed', { tag }), 'tag not deleted'))) return;
  new Notice(n ? t('deletedFrom', { tag, count: n }) : t('deleted', { tag }));
}

/** Tags of `group` in the index spelling, with files and declared without them; case-insensitive. */
function groupTags(storage: TagStorage, group: string): string[] {
  const key = tagKey(group);
  const found = new Map<string, string>();
  for (const tag of [...storage.allTags().map((each) => each.tag), ...storage.declaredTags()]) {
    const own = tagGroup(tag);
    const id = tagKey(tag);
    if (own !== null && id !== null && tagKey(own) === key && !found.has(id)) found.set(id, tag);
  }
  return [...found.values()];
}

/**
 * "Delete group…": like "Delete tag…" for every tag of the group, in one confirmation with the number of its
 * tags and of existing files that lose them; files themselves stay. Each tag is one storage write, then the
 * group's color and exclusive flag are dropped, so a new group of that name starts clean.
 */
export function askDeleteGroup(app: App, storage: TagStorage, group: string, exists: Exists): void {
  const tags = groupTags(storage, group);
  const files = new Set(tags.flatMap((tag) => storage.filesWithTag(tag)).filter(exists));
  const lines = [
    tags.length ? t('deleteGroupTags', { count: tags.length }) : t('deleteGroupEmpty'),
    files.size ? t('deleteGroupFrom', { count: files.size }) : t('deleteNoFiles'),
    t('deleteGroupGone'),
  ];
  new ConfirmModal(
    app,
    t('deleteGroup', { group }),
    lines,
    t('delete'),
    () => void deleteGroupNow(storage, group, tags, files.size),
    true,
  ).open();
}

async function deleteGroupNow(storage: TagStorage, group: string, tags: string[], n: number): Promise<void> {
  const failed = t('deleteGroupFailed', { group });
  for (const tag of tags)
    if (!(await write(() => storage.deleteTag(tag), failed, 'group not deleted'))) return;
  const { exclusive, color } = storage.groupSettings(group);
  if (color !== null && !(await write(() => storage.setGroupColor(group, null), failed, 'group color kept')))
    return;
  if (exclusive && !(await write(() => storage.setGroupExclusive(group, false), failed, 'group flag kept')))
    return;
  new Notice(n ? t('deletedGroupFrom', { group, count: n }) : t('deletedGroup', { group }));
}

/**
 * Groups for "Move to group…": all groups of index records. A group whose tags remain only on deleted files
 * still exists: moving into it keeps its flag and color, and it cannot be offered as a "New group". Tag
 * counts follow the "All tags" list, so such a group shows 0.
 */
function groupsToPick(app: App, storage: TagStorage): GroupInfo[] {
  const listed = new Map(tagGroups(listedTags(app, storage)).map((info) => [info.key, info]));
  return tagGroups(storage.allTags()).map((info) => listed.get(info.key) ?? { ...info, tags: 0 });
}

/**
 * Moves a tag into group `group` (`null` to remove it from a group) by renaming. A merge with an existing tag
 * and removing siblings in an exclusive group share one confirmation, one line each. Merge vs. rename is
 * decided over all index records (`planRename`); the target tag's file count follows the "All tags" list,
 * existing files only. Also the drop of a dragged tag on a group row or on "All tags" (tag-list.ts).
 */
export function moveTag(
  app: App,
  storage: TagStorage,
  tag: string,
  group: string | null,
  exists: Exists,
): void {
  const plan = planRename(tag, groupedName(tag, group), storage.allTags());
  if (plan.kind === 'refuse') {
    new Notice(plan.reason);
    return;
  }
  const lines: string[] = [];
  if (plan.kind === 'merge') {
    const files = listedFiles(app, storage, plan.to);
    const names = { to: plan.to, tag };
    lines.push(files ? t('moveMergeHasFiles', { ...names, count: files }) : t('moveMergeNoFiles', names));
  }
  const choices = moveChoices(storage, [{ from: tag, to: plan.to }], group, exists);
  const title = group === null ? t('removeFromGroup') : t('moveToGroup');
  if (choices.length)
    return askKept(
      app,
      storage,
      title,
      lines,
      choices,
      group,
      (kept) => void moveNow(storage, tag, plan.to, exists, keepChoices(storage, choices, kept)),
    );
  const run = () => void moveNow(storage, tag, plan.to, exists);
  if (!lines.length) return run();
  new ConfirmModal(app, title, lines, t('move'), run).open();
}

/** The choice window for an exclusive group: the lines, the line that asks, then the rows. */
function askKept(
  app: App,
  storage: TagStorage,
  title: string,
  lines: readonly string[],
  choices: readonly MoveChoice[],
  group: string | null,
  run: (kept: readonly string[]) => void,
): void {
  const all = [...lines, t('exclusivePick', { group: group ?? '' })];
  new MoveChoiceModal(app, title, all, choices, (tag) => storage.tagColor(tag), run).open();
}

/**
 * After the move: files of a row whose kept tag is not the one written last get it again, and in an exclusive
 * group tagging removes its siblings (`addTags`).
 */
function keepChoices(
  storage: TagStorage,
  choices: readonly MoveChoice[],
  kept: readonly string[],
): () => Promise<void> {
  return async () => {
    for (const [at, choice] of choices.entries()) {
      const tag = kept[at] ?? choice.kept;
      if (tag !== choice.kept) await storage.addTags(choice.paths, [tag]);
    }
  };
}

/**
 * The notice's file count includes only existing files, before the write, as in the dialogs; the write covers
 * all.
 */
async function moveNow(
  storage: TagStorage,
  from: string,
  to: string,
  exists: Exists,
  after: () => Promise<void> = async () => {},
): Promise<void> {
  const n = storage.filesWithTag(from).filter(exists).length;
  const run = async () => {
    await renameTag(storage, from, to);
    await after();
  };
  if (!(await write(run, t('moveFailed', { tag: from }), 'tag not moved'))) return;
  new Notice(t('renamedTag', { from, to, count: n }));
}

/**
 * Menu of several tags picked with Ctrl and Shift in "All tags": "Move to group…" and "Remove from group"
 * for all of them, one "Color…" for all, and "Delete N tags…" in red, each with one confirmation.
 */
export function showTagsMenu(
  app: App,
  storage: TagStorage,
  tags: readonly string[],
  at: MenuAt,
  exists: Exists = anyRecord,
): Menu {
  const menu = new Menu();
  menu.addItem((item) =>
    item
      .setSection('action')
      .setTitle(t('menuMoveToGroup'))
      .setIcon('folder-input')
      .onClick(() =>
        new GroupPickModal(app, groupsToPick(app, storage), null, (into) =>
          moveTags(app, storage, tags, into, exists),
        ).open(),
      ),
  );
  if (tags.some((tag) => tagGroup(tag) !== null))
    menu.addItem((item) =>
      item
        .setSection('action')
        .setTitle(t('removeFromGroup'))
        .setIcon('folder-output')
        .onClick(() => moveTags(app, storage, tags, null, exists)),
    );
  const [first] = tags;
  menu.addItem((item) =>
    item
      .setSection('action')
      .setTitle(t('menuColor'))
      .setIcon('palette')
      .onClick(() =>
        pickColor(
          app,
          storage,
          t('tagsColor', { count: tags.length }),
          first === undefined ? null : storage.tagColor(first),
          async (value) => {
            for (const tag of tags) await storage.setTagColor(tag, value);
          },
        ),
      ),
  );
  menu.addItem((item) =>
    item
      .setSection('danger')
      .setTitle(t('menuDeleteTags', { count: tags.length }))
      .setIcon('trash-2')
      .setWarning(true)
      .onClick(() => askDeleteTags(app, storage, tags, exists)),
  );
  return showRowMenu(menu, at);
}

/**
 * Deletes several tags after one confirmation with their count and the number of existing files that lose
 * them; files stay. One storage write per tag, as "Delete group…".
 */
export function askDeleteTags(app: App, storage: TagStorage, tags: readonly string[], exists: Exists): void {
  const files = new Set(tags.flatMap((tag) => storage.filesWithTag(tag)).filter(exists));
  const lines = [
    files.size ? t('deleteGroupFrom', { count: files.size }) : t('deleteNoFiles'),
    t('deleteTagsGone'),
  ];
  new ConfirmModal(
    app,
    t('deleteTags', { count: tags.length }),
    lines,
    t('delete'),
    () => void deleteTagsNow(storage, tags),
    true,
  ).open();
}

async function deleteTagsNow(storage: TagStorage, tags: readonly string[]): Promise<void> {
  for (const tag of tags)
    if (!(await write(() => storage.deleteTag(tag), t('deleteTagsFailed'), 'tags not deleted'))) return;
  new Notice(t('deletedTags', { count: tags.length }));
}

/** Merges listed one per line in the move confirmation; more become one line. */
const MERGE_LINES = 3;

/**
 * Moves several tags into `group` (`null`: out of their groups) by the rules of `moveTag`: a tag already
 * there is left alone, a refused name gets its notice, merges and exclusive-group losses share one
 * confirmation; then one rename after another and one notice.
 */
export function moveTags(
  app: App,
  storage: TagStorage,
  tags: readonly string[],
  group: string | null,
  exists: Exists,
): void {
  const moves: { from: string; to: string }[] = [];
  const merges: string[] = [];
  const merged: string[] = [];
  for (const tag of tags) {
    const name = groupedName(tag, group);
    if (name === tag) continue;
    const plan = planRename(tag, name, storage.allTags());
    if (plan.kind === 'refuse') {
      new Notice(plan.reason);
      continue;
    }
    if (plan.kind === 'merge') {
      const files = listedFiles(app, storage, plan.to);
      const names = { to: plan.to, tag };
      merges.push(files ? t('moveMergeHasFiles', { ...names, count: files }) : t('moveMergeNoFiles', names));
      merged.push(tag);
    }
    moves.push({ from: tag, to: plan.to });
  }
  if (!moves.length) return;
  // One line per merge while there are few; more become one line with their names, and the files of an
  // exclusive group that lose a tag are counted once over all moved tags (word of the owner 27.10: the same
  // line stood once per tag).
  const lines =
    merges.length <= MERGE_LINES
      ? merges
      : [t('moveMergeMany', { count: merged.length, tags: merged.map((tag) => `«${tag}»`).join(', ') })];
  const title = group === null ? t('removeFromGroup') : t('moveToGroup');
  const choices = moveChoices(storage, moves, group, exists);
  if (choices.length)
    return askKept(
      app,
      storage,
      title,
      lines,
      choices,
      group,
      (kept) => void moveTagsNow(storage, moves, keepChoices(storage, choices, kept)),
    );
  const run = () => void moveTagsNow(storage, moves);
  if (!lines.length) return run();
  new ConfirmModal(app, title, lines, t('move'), run).open();
}

async function moveTagsNow(
  storage: TagStorage,
  moves: readonly { from: string; to: string }[],
  after: () => Promise<void> = async () => {},
): Promise<void> {
  for (const { from, to } of moves)
    if (!(await write(() => renameTag(storage, from, to), t('moveTagsFailed'), 'tags not moved'))) return;
  if (!(await write(after, t('moveTagsFailed'), 'kept tags not set'))) return;
  new Notice(t('movedTags', { count: moves.length }));
}
