// Obsidian's plugin linter over the plugin source, as the community directory review runs it.
// The repository root is the base path: the plugin reads manifest.json (minAppVersion) from the working directory.
import path from 'node:path';
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

const root = path.resolve(import.meta.dirname, '..', '..');

export default defineConfig([
  ...obsidianmd.configs.recommended.map((config) => ({ ...config, basePath: root })),
  {
    basePath: root,
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: root } },
  },
]);
