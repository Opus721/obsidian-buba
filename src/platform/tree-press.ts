// Where a press on a tree row lands, the same on a computer and a phone, with any theme (word of the owner
// 27.10): the folder, tag group or item icon expands or collapses the row; the name and everything right of
// it, the arrow and the count included, open it. The arrow after the name only shows the state. The icon's
// zone takes the row's start before it and a little slack after it, so a press that just misses still folds.
// On a row that cannot expand a press in the icon's zone does nothing: it does not open the folder either, so
// a press meant to expand never leaves the tree (word of the owner 27.10 17:28).
/** Slack after the icon, px: half the gap to the name (`--buba-tree-gap`, 8 px). */
const ICON_SLACK_PX = 4;

/** Parts of a tree row: the arrow (`null` when the row cannot expand), the folder or item icon, the name. */
export interface RowParts {
  arrow: Element | null;
  icon: Element | null;
  name: HTMLElement | null;
}

/**
 * Whether the press at `at`, `x` px from the window's left, lands in the icon's zone of the row of `parts`: on
 * the icon, or left of its right edge plus the slack. Such a press expands or collapses a row that can expand
 * and does nothing on one that cannot. A click without a pointer position, as Enter on a focused row, opens.
 */
export function foldPress(parts: RowParts, at: Element, x: number): boolean {
  const { arrow, icon } = parts;
  if (!icon) return false;
  if (icon.contains(at)) return true;
  if (arrow?.contains(at) || !(x > 0)) return false;
  return x <= icon.getBoundingClientRect().right + ICON_SLACK_PX;
}
