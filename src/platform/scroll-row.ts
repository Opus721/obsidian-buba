// A tree row scrolled into view inside its scrolling field, by rectangles rather than `scrollIntoView`, which
// also moves ancestors with `overflow: hidden`. The visible part is the field without its padding: on a phone
// Obsidian 1.14.4 puts the tree's floating buttons over the bottom of the field and gives it bottom padding for
// them (app.css, `.is-mobile.is-floating-nav.is-phone … .nav-header ~ div:last-child`).

/** Scrolls `field` so the whole `row` is visible; a row already visible leaves it. */
export function scrollRowIntoField(field: HTMLElement, row: HTMLElement): void {
  const box = field.getBoundingClientRect();
  const pad = field.win.getComputedStyle(field);
  const top = box.top + (parseFloat(pad.paddingTop) || 0);
  const bottom = box.bottom - (parseFloat(pad.paddingBottom) || 0);
  const at = row.getBoundingClientRect();
  if (at.top < top) field.scrollTop -= top - at.top;
  else if (at.bottom > bottom) field.scrollTop += at.bottom - bottom;
}
