// Settings → Buba. Obsidian 1.13+ draws the definitions (`getSettingDefinitions`) with its own search and
// stores our keys through `PluginSettingTab.setControlValue` → `plugin.settings` → `saveData`. Only
// Obsidian components. The order follows Obsidian's plugin settings guidelines (Plugins → User interface
// → Settings): general rows on top without a heading, then "Appearance", "Language and region" and "What
// Obsidian needs"; each description is one sentence about what changes, only the keys row has a list.
// "Appearance" applies at once: after the write, classes go on `body` (src/platform/tree-look.ts). Our only
// own style is the dropdown width (settings.css).
import {
  Notice,
  Platform,
  PluginSettingTab,
  Setting,
  type App,
  type Plugin,
  type SettingDefinitionItem,
} from 'obsidian';
import { t } from '../../core/i18n/dict/settings.ts';
import type { DateFormat, TimeFormat } from '../../core/inspector/date.ts';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  TREE_LINES_OPACITY,
  type BubaSettings,
  type TreeLines,
} from '../../core/settings/settings.ts';
import { coreSetting, enableCoreSetting, setCoreSetting } from '../../platform/core-settings.ts';
import type { CoreFlag } from '../../platform/setup.ts';
import { settingsChanged, settingsOf } from '../../platform/settings.ts';
import { applyTreeLook } from '../../platform/tree-look.ts';
import { openSetupWindow } from './setup-window.ts';
import './settings.css';

/** The "Grid keys" row: the name serves search, the description is a fragment with a list (`gridKeysDesc`). */
const gridKeys = () => ({ name: t('gridKeys') });
/** Grid keys, one line per list item. */
export const gridKeyLines = (): string[] => [
  t('gridKeyTag'),
  t('gridKeyRating'),
  t('gridKeySpace'),
  t('gridKeyUndo'),
];
/**
 * "Grid keys" description: a line and a list (`desc: string | DocumentFragment`; Obsidian's search reads
 * `textContent`). Each call returns a new fragment.
 */
export const gridKeysDesc = (): DocumentFragment =>
  createFragment((f) => {
    f.appendText(t('gridKeysIntro'));
    const list = f.createEl('ul');
    for (const line of gridKeyLines()) list.createEl('li', { text: line });
  });

/**
 * "Clicks in the file panel": how references and generations in the file panel open, a line and a list like
 * "Grid keys". No control: the grid keys toggle does not turn clicks off. Hidden on phones, which have no
 * modifier keys; the long-press menu works there.
 */
export const panelClicksDesc = (): DocumentFragment =>
  createFragment((f) => {
    f.appendText(t('panelClicksIntro'));
    const list = f.createEl('ul');
    for (const key of ['panelClickOpen', 'panelClickTab', 'panelClickFolder', 'panelClickMenu'] as const)
      list.createEl('li', { text: t(key) });
  });

/** Row name and description come from the dictionary at page draw time. */
type Row = { name: string; desc: string };
const row = (name: Parameters<typeof t>[0], desc: Parameters<typeof t>[0]) => (): Row => ({
  name: t(name),
  desc: t(desc),
});

/**
 * "Reveal open folder in the tree" row. Obsidian's file explorer has a header button for this ("Auto-reveal
 * current file"), Notebook Navigator a plugin setting. It is behavior, not appearance, so it sits on top,
 * outside "Appearance".
 */
const AUTO_REVEAL = row('autoReveal', 'autoRevealDesc');

// Group headings are the `group…` keys, without the word "settings", per Obsidian's heading guideline.
// "Language and region" is how Buba writes dates and times: a choice of its own, not Obsidian's language.

/** "Appearance" rows: shared by the folder and tag trees and by all devices. */
const TREE_LINES_ROW = row('treeLines', 'treeLinesDesc');
const treeLinesOptions = (): Record<TreeLines, string> => ({
  off: t('treeLinesOff'),
  grey: t('treeLinesGrey'),
  color: t('treeLinesColor'),
});
const TREE_OPACITY_ROW = row('treeOpacity', 'treeOpacityDesc');
const TREE_ARROW_ROW = row('treeArrow', 'treeArrowDesc');
const FOLDER_NAME_ROW = row('folderName', 'folderNameDesc');
const TAG_NAME_ROW = row('tagName', 'tagNameDesc');
/** "Buba" label in menus: the word "Buba" to the right of our menu items; off means no label. */
const MENU_OWN_ROW = row('menuOwn', 'menuOwnDesc');

/** "Language and region" rows: all Buba dates, in the file panel and comments. */
const DATE_FORMAT_ROW = row('dateFormat', 'dateFormatDesc');
const dateFormatOptions = (): Record<DateFormat, string> => ({ dmy: t('dateDmy'), mdy: t('dateMdy') });
/** Time samples are substituted, so translation and the pseudo-locale leave them alone. */
const TIME_FORMAT_ROW = (): Row => ({
  name: t('timeFormat'),
  desc: t('timeFormatDesc', { h24: '23:31', h12: '11:31 PM' }),
});
const timeFormatOptions = (): Record<TimeFormat, string> => ({ '24h': t('time24'), '12h': t('time12') });

/** Opacity slider label `40 %`, with a no-break space between number and "%" so it does not wrap. */
export const opacityText = (value: number): string => `${value}\u00a0%`;

/**
 * Sync reminder: Buba cannot see Sync settings, since each device has its own and there is no public access
 * to them. The path to them and the warnings are in the "What Obsidian needs" window (setup-window.ts),
 * opened by "Check" below.
 */
const SYNC_ROW = row('syncOther', 'syncOtherDesc');

/**
 * Obsidian settings in Obsidian's own wording. Descriptions read "without it …": on a phone the state ("On. "
 * / "Off. ", `#coreRow`) is put in front, and the sentence works with both.
 */
const CORE_ROWS: readonly { key: CoreFlag; text: () => Row }[] = [
  { key: 'alwaysUpdateLinks', text: row('alwaysUpdateLinks', 'alwaysUpdateLinksDesc') },
  { key: 'showUnsupportedFiles', text: row('showAllTypes', 'showAllTypesDesc') },
];

const DELETE_PROMPT_ROW = row('promptDelete', 'promptDeleteDesc');
const SETUP_CHECK_ROW = row('setupCheck', 'setupCheckDesc');

export class BubaSettingTab extends PluginSettingTab {
  readonly #plugin: Plugin;

  constructor(app: App, plugin: Plugin) {
    super(app, plugin);
    this.#plugin = plugin;
    this.icon = 'bird';
    // Our own tab class, for the dropdown width (settings.css): Obsidian's own dropdowns are unchanged.
    this.containerEl.addClass('buba-settings');
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        ...gridKeys(),
        desc: gridKeysDesc(),
        control: { type: 'toggle', key: 'gridKeys', defaultValue: true },
      },
      { name: t('panelClicks'), desc: panelClicksDesc(), visible: () => !Platform.isMobile },
      {
        ...AUTO_REVEAL(),
        control: { type: 'toggle', key: 'autoRevealFolder', defaultValue: DEFAULT_SETTINGS.autoRevealFolder },
      },
      {
        type: 'group',
        heading: t('groupLook'),
        items: [
          {
            ...TREE_LINES_ROW(),
            control: {
              type: 'dropdown',
              key: 'treeLines',
              options: treeLinesOptions(),
              defaultValue: DEFAULT_SETTINGS.treeLines,
            },
          },
          {
            ...TREE_OPACITY_ROW(),
            // Obsidian calls `refreshDomState()` after `setControlValue` itself, so the predicate is re-read.
            visible: () => this.#look().treeLines === 'color',
            control: {
              type: 'slider',
              key: 'treeLinesOpacity',
              ...TREE_LINES_OPACITY,
              defaultValue: DEFAULT_SETTINGS.treeLinesOpacity,
              displayFormat: opacityText,
            },
          },
          {
            ...TREE_ARROW_ROW(),
            control: { type: 'toggle', key: 'treeArrowColor', defaultValue: DEFAULT_SETTINGS.treeArrowColor },
          },
          {
            ...FOLDER_NAME_ROW(),
            control: {
              type: 'toggle',
              key: 'treeFolderNameColor',
              defaultValue: DEFAULT_SETTINGS.treeFolderNameColor,
            },
          },
          {
            ...TAG_NAME_ROW(),
            control: {
              type: 'toggle',
              key: 'treeTagNameColor',
              defaultValue: DEFAULT_SETTINGS.treeTagNameColor,
            },
          },
          {
            ...MENU_OWN_ROW(),
            control: { type: 'toggle', key: 'menuOwnLabel', defaultValue: DEFAULT_SETTINGS.menuOwnLabel },
          },
        ],
      },
      {
        type: 'group',
        heading: t('groupRegion'),
        items: [
          {
            ...DATE_FORMAT_ROW(),
            control: {
              type: 'dropdown',
              key: 'dateFormat',
              options: dateFormatOptions(),
              defaultValue: DEFAULT_SETTINGS.dateFormat,
            },
          },
          {
            ...TIME_FORMAT_ROW(),
            control: {
              type: 'dropdown',
              key: 'timeFormat',
              options: timeFormatOptions(),
              defaultValue: DEFAULT_SETTINGS.timeFormat,
            },
          },
        ],
      },
      {
        type: 'group',
        heading: t('groupObsidian'),
        items: [
          ...CORE_ROWS.map(({ key, text }) => {
            const { name, desc } = text();
            return { name, desc, render: (setting: Setting) => this.#coreRow(setting, key, desc) };
          }),
          SYNC_ROW(),
          { ...DELETE_PROMPT_ROW(), render: (setting: Setting) => this.#deletePromptRow(setting) },
          { ...SETUP_CHECK_ROW(), render: (setting: Setting) => this.#checkRow(setting) },
        ],
      },
    ];
  }

  /**
   * Obsidian 1.13+ wrote a row value (`plugin.settings`, `saveData`): the tree and menu look change at once,
   * and so do the open file panel's dates (`settingsChanged`).
   */
  override async setControlValue(key: string, value: unknown): Promise<void> {
    await super.setControlValue(key, value);
    applyTreeLook(settingsOf(this.#plugin));
    settingsChanged(this.#plugin);
  }

  /**
   * Settings normalized by `normalizeSettings`: Obsidian 1.13+ puts the row value into `plugin.settings` as
   * is.
   */
  #look(): BubaSettings {
    return normalizeSettings(settingsOf(this.#plugin));
  }

  /**
   * An Obsidian setting row: its value (since 1.13.1) and, when off, "Enable". On a phone Obsidian stretches
   * the button to the full width and the value next to it gets cut, so there the state is the first word of
   * the description, like Obsidian's action rows ("Your account", "Current plugins"), and the button stands
   * alone.
   */
  #coreRow(setting: Setting, key: CoreFlag, desc: string): void {
    const on = coreSetting(this.app, key) === true;
    if (Platform.isPhone) setting.setDesc(t(on ? 'stateOnDesc' : 'stateOffDesc', { desc }));
    else
      setting.addDisplayValue((value) => {
        value.setValue(t(on ? 'stateOn' : 'stateOff'));
        if (!on) value.setStatus('warning');
      });
    if (on) return;
    setting.addButton((button) =>
      button
        .setButtonText(t('enable'))
        .setCta()
        .onClick(async () => {
          if (!(await enableCoreSetting(this.app, key))) new Notice(t('enableFailedFiles'));
          this.update();
        }),
    );
  }

  #deletePromptRow(setting: Setting): void {
    let restoring = false;
    setting.addToggle((toggle) =>
      toggle.setValue(coreSetting(this.app, 'promptDelete') === true).onChange(async (value) => {
        if (restoring) return;
        if (!(await setCoreSetting(this.app, 'promptDelete', value))) {
          // The native setValue also calls onChange: restoring the UI must not write the setting.
          restoring = true;
          toggle.setValue(coreSetting(this.app, 'promptDelete') === true);
          restoring = false;
          new Notice(t('saveFailedFiles'));
        }
      }),
    );
  }

  #checkRow(setting: Setting): void {
    setting.addButton((button) => button.setButtonText(t('check')).onClick(() => openSetupWindow(this.app)));
  }
}
