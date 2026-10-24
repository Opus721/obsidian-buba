// Right-aligned "Buba" label on our own items in menus that mix Obsidian items with ours (file menus, the
// grid's ⋮). Menus with only our items, and section headers, get no label. The API gives a menu item no
// class, so the label is an empty span in the title fragment and the word comes from CSS `::after`: the title
// text read by native menus and menu search stays clean (native menus show no label, an Obsidian limitation).
// A setting hides the label with a class on `body`, so items are not rebuilt. The text sits in
// `.buba-menu-text` because a bare text node in a flex title neither shrinks nor gets an ellipsis, and a long
// item pushed the label past the edge.
import './menu-title.css';

/** Title of our item in a mixed menu: the `.buba-menu-text` text, then the empty `.buba-menu-own` label. */
export function ownTitle(title: string): DocumentFragment {
  return createFragment((f) => {
    f.createSpan({ cls: 'buba-menu-text', text: title });
    f.createSpan({ cls: 'buba-menu-own', attr: { 'aria-hidden': 'true' } });
  });
}
