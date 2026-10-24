// The format badge in the corner of a tile image is shown whole or not at all, the Priority+ pattern
// (https://css-tricks.com/the-priority-navigation-pattern/): compare the element size with the space and hide
// what does not fit. The DOM has no "clipped by an ancestor with `overflow: hidden`" flag, so the geometry is
// compared here. A CSS container query threshold does not work: the badge width depends on its text ("AI" is
// narrower than "CANVAS"), and a container query cannot see the row height.

/** Width and height, px. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

const valid = (value: number): boolean => Number.isFinite(value) && value >= 0;

/**
 * The badge fits inside the tile image whole, with the inset on every side; equality fits. Any non-finite or
 * negative value does not fit: an unmeasured badge is not shown.
 * @param thumb tile image, without the caption
 * @param inset badge inset from the image edge
 */
export function badgeFits(thumb: Size, badge: Size, inset: number): boolean {
  const known =
    valid(thumb.width) && valid(thumb.height) && valid(badge.width) && valid(badge.height) && valid(inset);
  return known && badge.width + 2 * inset <= thumb.width && badge.height + 2 * inset <= thumb.height;
}
