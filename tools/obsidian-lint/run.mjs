// Runs Obsidian's plugin linter on src/: errors fail (exit 1), warnings are printed and pass.
//   node tools/obsidian-lint/run.mjs
// Installs its own pinned dependencies on first run (npm ci in this folder).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const root = path.resolve(here, '..', '..');
const installed = path.join(here, 'node_modules', '.package-lock.json');
const lock = path.join(here, 'package-lock.json');
if (!fs.existsSync(installed) || fs.statSync(installed).mtimeMs < fs.statSync(lock).mtimeMs) {
  const npm = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd: here,
    stdio: 'inherit',
    shell: true,
  });
  if (npm.status !== 0) process.exit(2);
}
const eslint = path.join(here, 'node_modules', 'eslint', 'bin', 'eslint.js');
const result = spawnSync(process.execPath, [eslint, '-c', path.join(here, 'eslint.config.mjs'), 'src'], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 2);
