---
name: buba-obsidian
description: Work with an Obsidian vault that has the Buba plugin. Use it when you save a generated image, video or sound into the vault, so you record what made it, or to find, tag, rate or comment files and put them on a canvas.
---

# Buba in Obsidian

Buba is an Obsidian plugin that turns vault folders into an asset library. It adds `buba:*` commands to the Obsidian command line (desktop Obsidian, running, with the command line turned on in its settings). Every command answers with one JSON object; `ok: false` comes with an error code and changes nothing.

Check that Buba is there: `obsidian help` lists the `buba:*` commands.

## After you generate a file into the vault

Record its generation passport: model, provider, prompt, references and parameters. It shows in the file panel, and another agent can repeat the generation from it.

1. Read the format once: `obsidian buba:passport-help`. Its `guide` is the full instruction for the installed version of Buba. Follow it rather than this summary when they differ.
2. Save the result and every reference as files in the vault.
3. Write: `obsidian buba:passport path=<result> passport='<JSON>'`. Without the command line, drop a request file into `__buba-data/inbox/`, as the guide describes.
4. Check: `obsidian buba:passport-get path=<result>` returns the passport and `missing` is empty.

The prompt goes exactly as sent, references in the order the model got them, every setting in `params`. Never put API keys or other secrets into a passport.

## To repeat a generation

`obsidian buba:passport-get path=<file>` gives the prompt, the references with their current paths, the parameters and the service ids.

## Other commands

- `buba:find tag=<tag>`: files with a tag, or without tags, in the vault or a folder.
- `buba:info path=<file>`: tags, rating, comments and the generation of a file.
- `buba:tag`, `buba:rate`, `buba:comment`: set marks on files.
- `buba:open`: open a folder in the Buba grid or a `.canvas` board.
- `buba:canvas-add`: add file cards to a board.

`obsidian help <command>` lists the flags of each one.
