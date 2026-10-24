// The one icon button style for the whole plugin: icon color at rest, on hover, pressed and disabled, no
// border or shadow (`icon-button.css`). Module buttons (`ExtraButtonComponent`, `.clickable-icon` or
// `ButtonComponent` with an icon) get it through the class set here and never set their own icon color.
import './icon-button.css';

/**
 * Button look: `small` is a 14px icon in a 22px square (grid toolbar); `medium` is 16 in 24, 18 in 30 on
 * phones (file panel rows); no size keeps the Obsidian size (`.clickable-icon`) or the host's own (round
 * buttons); `filled` adds a grey fill under the icon, denser on hover.
 */
export type IconButtonLook = 'small' | 'medium' | 'filled';

/** Returns the same element with the icon button class and the look classes. */
export function iconButton<T extends HTMLElement>(el: T, ...looks: IconButtonLook[]): T {
  el.addClass('buba-icon-button', ...looks.map((look) => `mod-${look}`));
  return el;
}
