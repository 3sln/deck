#!/usr/bin/env node

// Regenerates src/highlight-theme.js from the installed highlight.js.
//
// Deck's client source has to stay plain ESM — no `?inline`, no CSS imports —
// so that Vite, @web/dev-server, Rspack and deck's own dev server can all serve
// it without a bundler-specific transform. The two themes are therefore
// vendored as JS strings rather than imported from `highlight.js/styles/*.css`.

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const deckRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const escape = source =>
  source.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const read = async name => {
  const hljsPackage = require.resolve('highlight.js/package.json');
  const file = path.join(path.dirname(hljsPackage), 'styles', name);
  return await fs.readFile(file, 'utf-8');
};

const light = await read('github.css');
const dark = await read('github-dark.css');

const output = `/**
 * The two highlight.js themes deck ships, vendored as plain JS strings.
 *
 * They live here rather than being imported from \`highlight.js/styles/*.css\`
 * because that import only works through a bundler that understands CSS — and
 * deck's own source has to stay plain ESM so every dev runtime it supports can
 * serve it unbundled.
 *
 * Copied verbatim from highlight.js (BSD-3-Clause). Regenerate with
 * \`node bin/vendor-themes.js\` after bumping the highlight.js dependency.
 */

export const githubLight = \`${escape(light)}\`;

export const githubDark = \`${escape(dark)}\`;
`;

await fs.writeFile(path.join(deckRoot, 'src/highlight-theme.js'), output);
console.log('Wrote src/highlight-theme.js');
