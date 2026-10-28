# Changelog

What changed in each release of Buba, in plain words. The newest release is at the top.

## 1.2.0

Buba works more like a file manager: open in new tabs, copy and paste, undo, pick several folders or tags at once.

- The middle mouse button opens a folder, tag, "All files", "Bookmarks" or a folder in the path in a new tab, as in Obsidian's file explorer; on a note, PDF or video it opens the file in a new tab, on a picture it opens the Buba viewer. Right-click a tile or a tree folder: "Open in new tab" comes first.
- A Buba tab is titled by what it shows, the folder, tag, "All files" or "Bookmarks", in the tab and next to the back and forward arrows, and follows a rename of the open folder.
- Ctrl+A selects every tile in the grid. Ctrl+C and Ctrl+V copy tiles into another folder. Right-click empty space in the grid for "New folder…", "New note", "New canvas", "New base" and "Paste".
- Ctrl+Z undoes the last Buba action, whatever it was.
- In the Buba tree, pick several folders or tags with Ctrl and Shift: give them one color or icon, move them, or delete them in one go. Delete on a tag or tag group asks first; "Delete group…" removes a group and takes its tags off files. Moving tags into an exclusive group asks which tag each file keeps.
- Moving thousands of files is about three times faster, with progress and a "Stop" button.
- "Bookmarks" in the Buba tree opens Obsidian's bookmarks as a grid. The tree sorts folders by created or modified time too, and its header has "New folder alongside", "New subfolder", "New tag", sort and collapse.
- The path above a note, PDF or canvas opens that folder in the Buba grid.
- Sort "by type" keeps files of one kind together by extension; "Then by" greys out the main key.
- Folder tiles: a glass front over the files inside with a soft shadow, a slightly darker glass in the light theme, and no jitter when the front lowers on hover. A collapsed tree folder with subfolders shows a closed folder icon.
- On a computer, right-click a .ttf, .otf or .ttc file and choose "Install font" to install it for your user, like Install in Windows Explorer; several fonts at once too.
- PSD and PSB previews come from the full picture, notes without text show their name, and a canvas shows the file selected on it in the file panel.
- On a phone, files opened from the grid get arrows to the next and previous file, and "Close" returns to the grid.

## 1.1.0

Folder tiles in the grid show what is inside: a cover you choose, or the folder's own look.

- Right-click a folder tile and choose "Upload cover…" to pick a picture on your computer or phone; the tile shows it. "Make folder cover" on a picture tile uses that picture for the folder it lies in. "Remove cover" takes it away. A cover is stored apart from the folder's files, in Buba's own data, so it never shows up among them, and it follows the folder when you rename or move it.
- A folder without a cover shows its own icon in its own color, as in the Buba tree. The name on the tile keeps the normal text color.
- A plain folder, with no cover and no color or icon of its own, shows its newest picture, or one from its subfolders; an empty folder keeps the grey folder icon.
- Covers show only on tiles, not in the tree.
- Right-click a folder with a cover and choose "Move cover" to frame it: drag to move the picture, scroll or pinch to zoom, then press Enter or click outside to keep it, or Esc to cancel. "Center cover" puts it back in the middle. A new cover starts in the middle.
- A folder tile is drawn as a folder: a straight back and a slanted front with the cover on it; the back takes the cover's color, or theme grey if you choose so in "Behind a cover in front". Hover over it on a computer and the front tips forward a little. A selected folder gets its tile area tinted with the accent color; "Folder selection" in Buba's settings can put a line around the front instead, which tips with it, or tint the area with a frame.
- A few of the folder's files lie inside the tile, in their own proportions, documents as pages; on a computer they fan out on hover. "Folder tiles" in Buba's settings turns them off.
- "Folder cover" in Buba's settings can put the cover on the back instead, behind a glass front in the colors of your theme.
- In Buba's settings, the appearance rows are sorted under small subheadings: folder and tag trees, grid tiles, menus.
- With the Style Settings plugin, the raised part of the folder front can go on the left instead of the right.

The Buba tree shows whether a folder or tag group is open by its icon, and opens smoothly.

- A folder without its own icon shows a closed folder; when you expand it, the icon opens. A folder with its own icon keeps it.
- "All tags" and tag groups show a stack of tags while closed and a single tag while open.
- With the Buba theme, from its version 1.1.1, the tree keeps no place for arrows on the left and moves left: a small arrow follows the name of a folder or tag group, as in Linear's sidebar, and a click or tap on it expands or collapses it. With other themes the arrows stay on the left. A double click on the name works everywhere, as before.
- On a computer, folders, tag groups and "All tags" open and close with a short slide. It is off when the system asks to reduce motion, and on a phone a tap opens at once, as before.

## 1.0.3

Long file names can be read in full, and a drag opens the closed folder or tag group it waits over.

- In the file panel the name field grows with the name: one line for a short name, two for a longer one, and so on up to five lines, after which it scrolls. The whole name is readable on a computer and on a phone, and the extension stays next to the last line. Enter still saves the name; a pasted line break becomes a space.
- On a computer, hover over a tile's name cut with "…" to see the whole name in a tooltip, like the path in the file panel.
- Hold a dragged folder, tag or tile over a closed folder or tag group in the Buba tree for a moment and it opens, as in Obsidian's file explorer: you can drop deeper and see where it landed.

## 1.0.2

Fixes for the folder tree, and the basic folder and tag moves it was missing.

- The arrow next to a folder now opens and closes it on every click, however fast you click, as in Obsidian's file explorer. Before, a quick second click was taken for half of a double click and did nothing. The same goes for the "All tags" row. A click on a folder name still shows its files, and a double click on the name still expands it.
- A folder can now be renamed and deleted right in the Buba tree: "Rename…" and, last in red, "Delete" in its menu. Delete asks first with Obsidian's own question; if files inside are references of generations, Buba names them before anything is deleted. The Delete key does the same for the highlighted folder right after you click it in the tree. Before, both were only in Obsidian's own file explorer. When the folder you were looking at is deleted, the grid shows the folder it was in, instead of an empty page under the old name.
- On a computer, drag a folder onto another folder to move it inside, from any level to any level; the folder under the pointer lights up. Drop it on "All files" or on the empty space below the folders to move it to the top level. An open folder stays open and highlighted at its new place, and Ctrl+Z in the grid moves it back.
- Drag a tag onto a tag group to move it into the group, or onto "All tags" to take it out of its group, the same as "Move to group…" and "Remove from group" in its menu.

## 1.0.1

Changes asked for by the Obsidian community review. Buba looks and works as before.

- The release is now built on GitHub straight from this source and signed there, so anyone can check that the released `main.js` is what the source builds.
- A file that could not be added in full goes to the trash your "Deleted files" setting names, instead of being deleted outright.
- The code follows the current review rules: new elements come from Obsidian's helpers, timers and frames from the window, and delete buttons use Obsidian's current red-button style.
- Lighter styles: four style rules that made Obsidian recheck the whole window are now plain classes.
- New screenshots: the folder tree with folder colours, and a generation passport.

## 1.0.0

First public release. Buba turns the folders of your vault into a visual asset library: you see every file as a preview, mark files with tags, ratings and comments, send them to a canvas and see what a generated file was made with. Your files stay where they are, as plain files.

**Browse**

- A folder tree on the left and a grid of previews in the middle, for any folder or for all files at once.
- Previews for images, GIFs, videos, PDFs, Photoshop (PSD, PSB) and Illustrator (AI) files, Markdown and text notes. Other files show a format badge.
- Three layouts: an even grid, justified rows and a waterfall. Tile size, file names, sorting by two keys and a file type filter are remembered per folder, or shared by all folders.
- Include files from subfolders, go back and forward through visited folders, open the parent folder.
- Folder colours and icons in the tree.

**Organise**

- Tags with colours and groups, a rating from one to five stars and comments for any file, not only notes. Mark a comment as done.
- A file panel on the right: preview, size and format, tags, rating, comments, a web link and the canvases the file is on.
- Open all files with a tag, or files without tags.
- Rename, duplicate, move and delete files from the grid, with undo.

**View and use**

- A full-screen viewer for images and videos, with keyboard and swipe navigation.
- Drag files from the grid onto a canvas, into a folder of the tree or into another app on your computer. Drop or paste files from your computer to add them to the open folder: the added files stay selected, and the grid scrolls to the first of them, so they never get lost in the sort order.

**Generation passports**

- When an agent generates a picture, video or sound for you, it records how: model, service, prompt, references, every parameter, the cost, when and by whom. The file panel shows it in a "Generation" section. Files without a passport show nothing new.
- The prompt is folded to six lines with "Show all", opens in its own window and copies in full. Reference tags in the prompt, such as @Image1, show the picture they mean and open it.
- References are thumbnails with the length of video and sound and an icon of their role, such as first and last frame; the role is named on hover. Click opens a file, Ctrl or Cmd opens it in a new tab, Alt shows it in its folder, right click or a long press opens the file menu. A reference that is no longer in the vault is a grey square with its name.
- Model, provider, type, every parameter, the cost, and when and by whom are one list under the references. A value too long for the panel stays on one line and shows whole on hover; on a phone a tap unfolds it.
- "Copy for agent" sits on the "Generation" heading for every file, folded too, and copies the whole passport, so another agent can repeat the generation.
- A file used as a reference shows "Used in generations" with the files made from it.
- Agents learn the passport format from Buba itself: `obsidian buba:passport-help` answers with the steps and every field. The skill in `skills/buba-obsidian` teaches an agent to write a passport for each file it generates.
- Passports follow files: moving or renaming a result or a reference, in Obsidian or in your system's file manager, keeps the links on both sides.
- Deleting a reference from Buba asks first and names the generations that will lose it, with "Show generations". Deleting it elsewhere, for example in Obsidian's file explorer, shows a notice with how to get it back.

**On the phone**

- The same grid, tree and file panel, laid out for a phone screen, with long-press menus.

**Look**

- Buba follows your Obsidian theme. With the [Style Settings](https://github.com/mgmeyers/obsidian-style-settings) plugin installed, its settings get a **Buba** section: row spacing in the folder and tag trees, tag sizes, how files without a preview look, the comment badge and the "Buba" label in menus. The phone has its own sliders where it needs other numbers.

**Languages**

- English, or Russian when Obsidian itself is in Russian. Dates, numbers and plural forms follow the language.

**For AI agents**

- Commands for the Obsidian command line: find files by tag, read and set tags, ratings and comments, open a folder and add file cards to a canvas.
- `buba:passport` records a generation passport, `buba:passport-get` reads it; `buba:info` tells whether a file has a passport. An agent without Obsidian's command line can drop a request file into `__buba-data/inbox`; Buba picks it up, also after Obsidian was closed.

**Requirements**

- Obsidian 1.13.1 or newer, on a computer or a phone.
- Update Buba on your computer and phone together: an older version on one device keeps passports hidden there and may lose the link to a renamed reference.

## 0.7.0

Test build before the first public release.

- The interface is in English, or in Russian when Obsidian itself is in Russian. Numbers, dates and plural forms follow the language.
- On a phone, a single tap in the viewer hides the close, fit-to-screen and arrow buttons; another tap brings them back.
- Settings drop-downs keep one width whatever is selected.
- The comment box grows taller before it starts to scroll.
- In the tag picker, the dot, group and count line up with the first line of a long tag name, as in the tag tree.
- Android: video previews are no longer blank, files keep their real names when added, and the edge swipe works next to the system back gesture.
