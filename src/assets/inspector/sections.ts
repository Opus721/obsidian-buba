// File panel sections are an extension point: a module adds its section, the panel draws them in order. The
// section shape lives in core (src/core/inspector/events.ts) for modules outside the panel. No `obsidian`
// import, tested with `node --test`.
import type { PanelSection } from '../../core/inspector/events.ts';

/**
 * Orders: preview 10, file fields 20, resolution 25, tags 30, rating 40, link 45, generation 47, used in
 * generations 48, comments 50, boards 55; other modules from 60.
 */
export type InspectorSection = PanelSection;

export class SectionRegistry {
  // One entry per add, so its undo removes exactly that add even if the same section was added twice.
  readonly #entries = new Set<{ section: InspectorSection }>();

  /** Adds a section; returns the undo. */
  add(section: InspectorSection): () => void {
    const entry = { section };
    this.#entries.add(entry);
    return () => {
      this.#entries.delete(entry);
    };
  }

  /** By `order`, ties by `id`. */
  list(): InspectorSection[] {
    return [...this.#entries]
      .map((entry) => entry.section)
      .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}
