# Changelog

What changed in each release of Buba, in plain words. The newest release is at the top.

## 1.0.0

First public release. Buba turns the folders of your vault into a visual asset library: you see every file as a
preview, mark files with tags, ratings and comments, send them to a canvas and see what a generated file was made
with. Your files stay where they are, as plain files.

**Browse**

- A folder tree on the left and a grid of previews in the middle, for any folder or for all files at once.
- Previews for images, GIFs, videos, PDFs, Photoshop (PSD, PSB) and Illustrator (AI) files, Markdown and text notes.
  Other files show a format badge.
- Three layouts: an even grid, justified rows and a waterfall. Tile size, file names, sorting by two keys and a file
  type filter are remembered per folder, or shared by all folders.
- Include files from subfolders, go back and forward through visited folders, open the parent folder.
- Folder colours and icons in the tree.

**Organise**

- Tags with colours and groups, a rating from one to five stars and comments for any file, not only notes. Mark a
  comment as done.
- A file panel on the right: preview, size and format, tags, rating, comments, a web link and the canvases the file is
  on.
- Open all files with a tag, or files without tags.
- Rename, duplicate, move and delete files from the grid, with undo.

**View and use**

- A full-screen viewer for images and videos, with keyboard and swipe navigation.
- Drag files from the grid onto a canvas, into a folder of the tree or into another app on your computer. Drop or
  paste files from your computer to add them to the open folder: the added files stay selected, and the grid scrolls
  to the first of them, so they never get lost in the sort order.

**Generation passports**

- When an agent generates a picture, video or sound for you, it records how: model, service, prompt, references,
  every parameter, the cost, when and by whom. The file panel shows it in a "Generation" section. Files without a
  passport show nothing new.
- The prompt is folded to six lines with "Show all", opens in its own window and copies in full. Reference tags in
  the prompt, such as @Image1, show the picture they mean and open it.
- References are thumbnails with the length of video and sound and an icon of their role, such as first and last
  frame; the role is named on hover. Click opens a file, Ctrl or Cmd opens it in a new tab, Alt shows it in its
  folder, right click or a long press opens the file menu. A reference that is no longer in the vault is a grey
  square with its name.
- Model, provider, type, every parameter, the cost, and when and by whom are one list under the references. A
  value too long for the panel stays on one line and shows whole on hover; on a phone a tap unfolds it.
- "Copy for agent" sits on the "Generation" heading for every file, folded too, and copies the whole passport, so
  another agent can repeat the generation.
- A file used as a reference shows "Used in generations" with the files made from it.
- Agents learn the passport format from Buba itself: `obsidian buba:passport-help` answers with the steps and every
  field. The skill in `skills/buba-obsidian` teaches an agent to write a passport for each file it generates.
- Passports follow files: moving or renaming a result or a reference, in Obsidian or in your system's file manager,
  keeps the links on both sides.
- Deleting a reference from Buba asks first and names the generations that will lose it, with "Show generations".
  Deleting it elsewhere, for example in Obsidian's file explorer, shows a notice with how to get it back.

**On the phone**

- The same grid, tree and file panel, laid out for a phone screen, with long-press menus.

**Look**

- Buba follows your Obsidian theme. With the [Style Settings](https://github.com/mgmeyers/obsidian-style-settings)
  plugin installed, its settings get a **Buba** section: row spacing in the folder and tag trees, tag sizes, how
  files without a preview look, the comment badge and the "Buba" label in menus. The phone has its own sliders where
  it needs other numbers.

**Languages**

- English, or Russian when Obsidian itself is in Russian. Dates, numbers and plural forms follow the language.

**For AI agents**

- Commands for the Obsidian command line: find files by tag, read and set tags, ratings and comments, open a folder
  and add file cards to a canvas.
- `buba:passport` records a generation passport, `buba:passport-get` reads it; `buba:info` tells whether a file has a
  passport. An agent without Obsidian's command line can drop a request file into `__buba-data/inbox`; Buba picks it
  up, also after Obsidian was closed.

**Requirements**

- Obsidian 1.13.1 or newer, on a computer or a phone.
- Update Buba on your computer and phone together: an older version on one device keeps passports hidden there and
  may lose the link to a renamed reference.

## 0.7.0

Test build before the first public release.

- The interface is in English, or in Russian when Obsidian itself is in Russian. Numbers, dates and plural forms follow the language.
- On a phone, a single tap in the viewer hides the close, fit-to-screen and arrow buttons; another tap brings them back.
- Settings drop-downs keep one width whatever is selected.
- The comment box grows taller before it starts to scroll.
- In the tag picker, the dot, group and count line up with the first line of a long tag name, as in the tag tree.
- Android: video previews are no longer blank, files keep their real names when added, and the edge swipe works next to the system back gesture.
