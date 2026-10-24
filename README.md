# Buba

Buba turns the folders of your vault into a visual asset library. Every file shows up as a preview in a grid: images,
videos, GIFs, PDFs, Photoshop and Illustrator files, notes. Mark files with tags, a rating and comments, find them
again in a click, look at them full screen and drag them onto a canvas. Your files stay where they are, as plain files
in plain folders.

![Buba on a computer: folder tree with folder colours and tags, grid of previews and the file panel with tags, rating and a comment](docs/readme/desktop.png)

## What it does

- **Folders as a grid of previews.** A folder tree on the left, a grid in the middle: one folder, a folder with its
  subfolders, or all files at once. Three layouts — an even grid, justified rows and a waterfall — with a tile size
  slider, file names on or off, sorting by two keys and a file type filter. Each folder can keep its own view.
- **Previews for many formats.** Images (PNG, JPG, GIF, WebP and more), videos, the first page of a PDF, the embedded
  preview of PSD, PSB and AI files, the beginning of Markdown and text notes. Videos play on hover on a computer.
- **Tags, rating and comments for any file**, not only for notes. Tags have colours and can be grouped; open every
  file with a tag, or every file without tags. Comments can be marked as done.
- **File panel.** Preview, size, format and resolution, tags, rating, comments, a web link for the file and the
  canvases it is on.
- **Viewer.** Open an image or a video full screen and move through the folder with the keyboard or a swipe.
- **Canvas.** Drag files from the grid onto a canvas to add them as cards.
- **Everyday file work.** Rename, duplicate, move and delete from the grid with undo. Drop or paste files from your
  computer to add them to the open folder, drag files from the grid into other apps.
- **Generation passport.** For a generated image, video or sound, the file panel shows what made it: model,
  service, the prompt with links to its references, every parameter, the cost, when and by whom. "Copy for agent"
  hands all of it to an agent that should repeat the generation. The passport is written by the agent that made
  the file (see below).
- **Commands for AI agents.** Buba adds commands to the Obsidian command line, so an agent can find files by tag, read
  and set tags, ratings and comments, open a folder, add file cards to a canvas and record generation passports:

  ```
  obsidian buba:find tag=hero
  obsidian buba:tag path=Moodboard/cover.jpg tag=print
  obsidian buba:rate path=Moodboard/cover.jpg rating=5
  obsidian buba:info path=Moodboard/cover.jpg
  ```

  Also `buba:comment`, `buba:open`, `buba:canvas-add`, `buba:passport`, `buba:passport-get` and `buba:passport-help`.

## For AI agents

If an AI agent generates files for you, let it record a passport for each one, so you see later what made it.

![The file panel of a generated picture: the prompt with links to its two references, the model, the parameters, the cost and the poster made from it](docs/readme/generation.png)

- **The skill.** Copy the folder [`skills/buba-obsidian`](skills/buba-obsidian) into your agent's skills folder,
  for example `~/.claude/skills/` for Claude Code. The agent then knows when to write a passport and how to use the
  other Buba commands.
- **Without the skill**, tell your agent to run `obsidian buba:passport-help`: it answers with the whole format and
  the steps for the Buba version you have installed.
- The commands need desktop Obsidian running, with the command line turned on in Obsidian's settings. An agent that
  can't use the command line can drop a request file into `__buba-data/inbox/` instead; the help explains how.

## Install

Buba needs Obsidian 1.13.1 or newer, on a computer or a phone.

In Obsidian: **Settings → Community plugins → Browse**, search for **Buba**, install and enable it.

To install by hand: download `main.js`, `manifest.json` and `styles.css` from the
[latest release](../../releases/latest), put them into the folder `<your vault>/.obsidian/plugins/buba/` and enable Buba
in **Settings → Community plugins**.

On first start Buba suggests two Obsidian options that help it work well: keep internal links updated when files move,
and detect all file extensions so that PSD, AI and other files show up. You can come back to them later in the Buba
settings.

## On the phone

Buba works in the Obsidian mobile app with the same grid, tree and file panel, laid out for a small screen. Menus
open with a long press. A few things need a computer: video playback on hover, dragging files into other apps and
dropping files from the file manager. To add files on a phone, share them to Obsidian from another app or use the add
items in the grid menu.

![Buba on a phone: grid of previews](docs/readme/phone.png)

## Languages

Buba follows the language of Obsidian: English by default, Russian when Obsidian is in Russian. Dates, numbers and
plural forms follow the language too. More languages may come later.

## Customize the look

Buba follows your Obsidian theme. With the [Style Settings](https://github.com/mgmeyers/obsidian-style-settings)
plugin installed, its settings get a **Buba** section: row spacing in the folder and tag trees, tag sizes, how files
without a preview look, the comment badge and the "Buba" label in menus. The phone has its own sliders where it needs
other numbers. Without Style Settings nothing changes.

## Where your data lives

- **Your files** are not moved, copied or converted. Buba only reads them to draw previews.
- **Tags, ratings, comments and generation passports** are saved in the folder `__buba-data` at the root of your
  vault, one small journal per device. The folder syncs with your vault, so marks reach your other devices through
  Obsidian Sync or any other sync service. Please don't delete or rename this folder: it holds the marks of all your devices. If you use Obsidian
  Sync, turn on **Sync all other types** in the Sync settings, otherwise the folder stays on this device.
- **Previews** are cached on each device in the app's local database, not in your vault, and are rebuilt when needed.
- **Settings** are stored in the plugin folder, like any other plugin's settings.
- **Error log.** Buba writes its own errors to a small local file, so that a problem can be looked into: on a computer
  in the plugin folder, on a phone or tablet in `__buba-data`. The file is never sent anywhere; it travels only with
  your own sync.

## Privacy

- No network requests, no telemetry, no account and no payment.
- Buba reads files from outside your vault only when you drop, paste or pick them yourself, to copy them into the
  vault.

## Coming later

Generating images and videos right from Buba, with your own keys for the services you choose.

## License

[MIT](LICENSE). Buba bundles two small libraries, `@tanstack/virtual-core` (MIT) and `idb` (ISC); their
licences are in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) and at the top of `main.js`.
