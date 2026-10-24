// Obsidian's native `FuzzySuggestModal`: search, icon, match highlighting and
// a mark on the current icon. The list comes from src/core/icon/choices.ts;
// desktop shows the whole set, a phone up to 500 results while searching all.
import {
  FuzzySuggestModal,
  Platform,
  getIconIds,
  renderResults,
  setIcon,
  type App,
  type FuzzyMatch,
} from 'obsidian';
import { t } from '../../core/i18n/dict/tree.ts';
import { DEFAULT_FOLDER_ICON, iconChoices, type IconChoice } from '../../core/icon/choices.ts';
import './icon-picker.css';

/** The native renderer draws every returned row; the phone limit comes from measured responsiveness. */
const MOBILE_ICON_LIMIT = 500;

export class FolderIconModal extends FuzzySuggestModal<IconChoice> {
  readonly #current: string | null;
  readonly #choose: (icon: string | null) => void;
  /** The list is built once per window: the suggest modal calls `getItems` on every keystroke. */
  #choices: IconChoice[] | null = null;
  /** The marked row: the folder's own icon if it is in the list, otherwise the default. */
  #marked: string | null = null;

  /**
   * `current` is the folder icon from storage (`null` for default); `choose` gets the chosen icon or `null`.
   */
  constructor(app: App, current: string | null, choose: (icon: string | null) => void) {
    super(app);
    this.#current = current;
    this.#choose = choose;
    this.setPlaceholder(t('iconSearch', { examples: 'camera, star, image…' }));
    const count = this.getItems().length;
    this.limit = Platform.isMobile ? Math.min(MOBILE_ICON_LIMIT, count) : count;
    if (this.limit < count)
      this.modalEl.createDiv({
        cls: 'buba-folder-icon-count setting-item-description',
        text: t('iconsShown', { limit: this.limit, count }),
      });
  }

  override getItems(): IconChoice[] {
    if (!this.#choices) {
      this.#choices = iconChoices(getIconIds());
      this.#marked = this.#choices.some((choice) => choice.id === this.#current) ? this.#current : null;
    }
    return this.#choices;
  }

  override getItemText(choice: IconChoice): string {
    return choice.text;
  }

  override renderSuggestion(match: FuzzyMatch<IconChoice>, el: HTMLElement): void {
    const { item } = match;
    el.addClass('mod-complex');
    const flair = el.createDiv({ cls: 'suggestion-icon' }).createSpan({ cls: 'suggestion-flair' });
    setIcon(flair, item.id ?? DEFAULT_FOLDER_ICON);
    const title = el.createDiv({ cls: 'suggestion-content' }).createDiv({ cls: 'suggestion-title' });
    renderResults(title, item.text, match.match);
    if (item.id === this.#marked)
      el.createDiv({ cls: 'suggestion-aux' }).createSpan({ cls: 'flair mod-pop', text: t('iconCurrent') });
  }

  override onChooseItem(choice: IconChoice): void {
    this.#choose(choice.id);
  }
}
