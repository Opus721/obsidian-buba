// Agent commands module: `buba:*` commands of the Obsidian command line. Uses only `core` and `platform`;
// each command adds one registration call here, as modules do in `src/assets/index.ts`.
import type { Plugin } from 'obsidian';
import { registerCanvasAdd } from './canvas-add.ts';
import { registerFind } from './find.ts';
import { registerInfo } from './info.ts';
import { registerMarks } from './marks.ts';
import { registerOpen } from './open.ts';
import { registerPassport } from './passport.ts';

export function registerCliModule(plugin: Plugin): void {
  registerInfo(plugin);
  registerFind(plugin);
  registerOpen(plugin);
  registerMarks(plugin);
  registerCanvasAdd(plugin);
  registerPassport(plugin);
}
