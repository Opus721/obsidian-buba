// Notices of the third-party code bundled into main.js: every package in `dependencies` of package.json, with its
// version, licence and full licence text from node_modules. MIT and ISC require the notice in every copy, and the
// release ships main.js alone, so the build puts the notices at the top of main.js (esbuild.config.mjs) and the
// repository keeps the same text in THIRD_PARTY_LICENSES.md.
//   node tools/third-party.mjs --write   regenerate THIRD_PARTY_LICENSES.md
//   node tools/third-party.mjs --check   fail if THIRD_PARTY_LICENSES.md is stale or a built main.js lacks a notice
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const NOTICES_FILE = path.join(root, 'THIRD_PARTY_LICENSES.md');
const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'license'];

/** Bundled packages with their licence texts, sorted by name. Throws if a package has no licence file. */
export function notices() {
  const { dependencies = {} } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return Object.keys(dependencies)
    .sort()
    .map((name) => {
      const dir = path.join(root, 'node_modules', name);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const file = LICENSE_FILES.map((entry) => path.join(dir, entry)).find((entry) => fs.existsSync(entry));
      if (!file) throw new Error(`${name}: no licence file in node_modules/${name}`);
      const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim();
      return { name, version: meta.version, license: meta.license, text };
    });
}

/** THIRD_PARTY_LICENSES.md as it should be. */
export function noticesMarkdown(list = notices()) {
  const parts = list.map(
    ({ name, version, license, text }) =>
      `## ${name} ${version} (${license})\n\n\`\`\`text\n${text}\n\`\`\`\n`,
  );
  return (
    '# Third-party licences\n\nBuba bundles the following packages into `main.js`. Their licence texts are reproduced ' +
    'below and at the top of `main.js`.\n\n' +
    parts.join('\n')
  );
}

/** Legal comment for the top of main.js; esbuild keeps `/*!` comments in a minified build. */
export function noticesBanner(list = notices()) {
  const body = list
    .map(({ name, version, license, text }) => `${name} ${version} (${license})\n\n${text}`)
    .join('\n\n---\n\n')
    .replace(/\*\//g, '* /');
  return `/*! Buba bundles third-party code. Licences:\n\n${body}\n*/`;
}

function check() {
  const problems = [];
  const list = notices();
  const current = fs.existsSync(NOTICES_FILE)
    ? fs.readFileSync(NOTICES_FILE, 'utf8').replace(/\r\n/g, '\n')
    : '';
  if (current !== noticesMarkdown(list))
    problems.push('THIRD_PARTY_LICENSES.md is stale: run node tools/third-party.mjs --write');
  const built = path.join(root, 'main.js');
  if (fs.existsSync(built)) {
    const js = fs.readFileSync(built, 'utf8');
    for (const { name, text } of list)
      if (!js.includes(text)) problems.push(`main.js has no licence notice of ${name}`);
  }
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exit(1);
  console.log(`Third-party notices in order: ${list.map(({ name }) => name).join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    fs.writeFileSync(NOTICES_FILE, noticesMarkdown());
    console.log(`Written ${path.relative(root, NOTICES_FILE)}`);
  } else if (process.argv.includes('--check')) check();
  else {
    console.error('Usage: node tools/third-party.mjs --write | --check');
    process.exit(2);
  }
}
