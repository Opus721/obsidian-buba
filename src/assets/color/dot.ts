// Color dot for a tag or tag group in the "All tags" tree, the tags window and the panel chips. Color is
// shown only as a dot; tiles are never tinted. The value comes from the journal and reaches `style` only
// after the pattern check (`colorCss`). A color that is hard to see on a theme background gets
// `mod-low-contrast-<theme>` (src/core/color/contrast.ts), and dot.css draws a ring for it under Obsidian's
// theme class on `body`. No `obsidian` import: elements come from Obsidian's DOM helpers (`createSpan`,
// `setCssProps`).
import { lowContrastThemes } from '../../core/color/contrast.ts';
import { colorCss } from '../../core/color/value.ts';
import './dot.css';

/** Ring classes: `mod-low-contrast-<theme>` for every theme whose background hides the color. */
export function contrastClasses(value: unknown): string[] {
  return lowContrastThemes(value).map((theme) => `mod-low-contrast-${theme}`);
}

/**
 * Color dot for `value` at the end of `parent`; a non-color (`null`, junk from the journal) gives no dot and
 * `null`.
 */
export function colorDot(parent: HTMLElement, value: unknown): HTMLElement | null {
  const css = colorCss(value);
  if (css === null) return null;
  const cls = ['buba-color-dot', ...contrastClasses(value)].join(' ');
  const dot = parent.createSpan({ cls, attr: { 'aria-hidden': 'true' } });
  dot.setCssProps({ '--buba-color': css });
  return dot;
}

/**
 * Tag dot: `colorDot` for a colored tag, a grey `mod-default` dot for a tag without color (or junk from the
 * journal), so a tag always has a dot. The data still has no color, this is only the look; the grey comes
 * from the `.buba-color-dot.mod-default` rule (src/assets/tags/tag-list.css).
 */
export function tagDot(parent: HTMLElement, value: unknown): HTMLElement {
  return (
    colorDot(parent, value) ??
    parent.createSpan({ cls: 'buba-color-dot mod-default', attr: { 'aria-hidden': 'true' } })
  );
}
