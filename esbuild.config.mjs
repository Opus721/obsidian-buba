// Plugin build: src/main.ts → main.js, component styles (*.css next to the code) → styles.css.
// The build number is the commit it was built from, baked into the code as __BUBA_COMMIT__. The public copy
// of the source has its own history, so it names that commit in `.build-commit` (tools/export-public.mjs):
// built there, main.js is the released file byte for byte.
import { execSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import fs from 'node:fs';
import esbuild from 'esbuild';
import { noticesBanner } from './tools/third-party.mjs';

const production = process.argv[2] === 'production';

function commit() {
  if (fs.existsSync('.build-commit')) return fs.readFileSync('.build-commit', 'utf8').trim();
  try {
    const quiet = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
    const sha = execSync('git rev-parse HEAD', quiet).trim();
    const dirty = execSync('git status --porcelain --untracked-files=no -- src', quiet).trim();
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return 'unknown';
  }
}

const context = await esbuild.context({
  entryPoints: { main: 'src/main.ts' },
  bundle: true,
  format: 'cjs',
  target: 'es2022',
  platform: 'browser',
  outdir: '.',
  external: [
    'obsidian',
    'electron',
    '@codemirror/*',
    '@lezer/*',
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
  ],
  define: { __BUBA_COMMIT__: JSON.stringify(commit()) },
  // Licence notices of the bundled packages: the release ships main.js alone (tools/third-party.mjs).
  banner: { js: noticesBanner() },
  sourcemap: production ? false : 'inline',
  minify: production,
  treeShaking: true,
  logLevel: 'info',
});

if (production) {
  await context.rebuild();
  await context.dispose();
  // esbuild writes the styles next to main.js as main.css; Obsidian reads styles.css.
  if (fs.existsSync('main.css')) fs.renameSync('main.css', 'styles.css');
  else fs.writeFileSync('styles.css', '');
} else {
  await context.watch();
}
