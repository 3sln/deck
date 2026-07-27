/**
 * Deck's build- and dev-time configuration: what a deck contains, and the HTML
 * shell it is served in.
 *
 * Node only. Every dev-server adapter and the production build read from here,
 * so a deck served by @web/dev-server and a deck built by `deck-build` disagree
 * about nothing.
 */

import fs from 'fs-extra';
import path from 'node:path';
import {globSync} from 'glob';
import {webcrypto} from 'node:crypto';

export async function sha256(str) {
  const textAsBuffer = new TextEncoder().encode(str);
  const hashBuffer = await webcrypto.subtle.digest('SHA-256', textAsBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const DEFAULT_OUT_DIR = 'out';

export async function loadDeckConfig(root) {
  const userPkgJsonPath = path.resolve(root, 'package.json');
  const userPkgJson = fs.existsSync(userPkgJsonPath) ? await fs.readJson(userPkgJsonPath) : {};
  const options = userPkgJson['@3sln/deck'] || {};

  // Resolved before the defaults are built, because the output directory has to
  // exclude itself: with a custom `outDir` the old hard-coded `out/**` missed
  // it, and the next build copied the previous build's output back in as cards.
  const outDir = options.build?.outDir ?? options.outDir ?? DEFAULT_OUT_DIR;
  const outGlob = `${outDir.replace(/^\.\//, '').replace(/\/+$/, '')}/**`;

  const defaultConfig = {
    title: 'Deck',
    favicon: null,
    scripts: [],
    stylesheets: [],
    pinned: [],
    pick: {},
    outDir,
    include: ['**/*'],
    exclude: [
      '**/node_modules/**',
      outGlob,
      '**/.git/**',
      '**/package.json',
      '**/package-lock.json',
      '**/bun.lock',
      '**/bun.lockb',
      '**/vite.config.js',
      '**/web-dev-server.config.mjs',
      '**/rspack.config.js',
      '**/webpack.config.js',
    ],
  };

  const baseConfig = {...defaultConfig, ...options};

  return {
    ...baseConfig,
    dev: {...baseConfig, ...(options.dev || {})},
    build: {...baseConfig, ...(options.build || {})},
  };
}

export function getProjectFiles(root, config) {
  return globSync(config.include, {
    cwd: root,
    ignore: config.exclude,
    nodir: true,
    dot: true,
  });
}

export function getCardFiles(root, config) {
  return getProjectFiles(root, config).filter(s => s.endsWith('.md') || s.endsWith('.html'));
}

/** A card path as the browser sees it: rooted, forward-slashed. */
export function toWebPath(file) {
  return '/' + file.split(path.sep).join('/');
}

const escapeHtml = value =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * JSON destined for an inline `<script>`.
 *
 * A card path or title containing `</script` would otherwise close the element
 * early and drop the rest of the page into the document as text — the classic
 * way for perfectly innocent content to break a page. U+2028 and U+2029 are
 * valid JSON but are line terminators to a JavaScript parser.
 */
const LINE_TERMINATORS = /[\u2028\u2029]/g;

const escapeJson = value =>
  JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(LINE_TERMINATORS, c => (c === '\u2028' ? '\\u2028' : '\\u2029'));

const attrs = spec =>
  Object.entries(spec)
    .map(([k, v]) => (v === true ? k : `${k}="${escapeHtml(v)}"`))
    .join(' ');

export function getHtmlTemplate({
  title,
  description,
  importMap,
  initialCardsData,
  pinnedCardPaths,
  entryFile,
  cssFiles = [],
  favicon,
  scripts = [],
  stylesheets = [],
  searchIndexUrl = null,
  dev = false,
  headExtra = '',
}) {
  const scriptTags = scripts
    .map(s =>
      typeof s === 'string'
        ? `<script src="${escapeHtml(s)}"></script>`
        : `<script ${attrs(s)}></script>`,
    )
    .join('\n');

  const styleTags = stylesheets
    .map(s =>
      typeof s === 'string'
        ? `<link rel="stylesheet" href="${escapeHtml(s)}">`
        : `<link rel="stylesheet" ${attrs(s)}>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="color-scheme" content="light dark">
    <title>${escapeHtml(title ?? 'Deck')}</title>
    ${description ? `<meta name="description" content="${escapeHtml(description)}">` : ''}
    ${favicon ? `<link rel="icon" href="${escapeHtml(favicon)}">` : ''}
    ${
      dev
        ? ''
        : `<meta name="robots" content="index, follow">
    <!--
      This page is an application; the deck's content is these files. An agent
      that cannot run it should read one of them instead of this.
    -->
    <link rel="alternate" type="text/markdown" href="/agents.md" title="The whole deck as one Markdown document">
    <link rel="alternate" type="text/plain" href="/llms.txt" title="An index of every card">`
    }
    ${styleTags}
    ${importMap ? `<script type="importmap">${escapeJson(importMap)}</script>` : ''}
    ${headExtra}
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      :root {
        --bg-color: #fff; --text-color: #222; --muted-color: #666; --border-color: #e5e5e5;
        --card-bg: #fff; --card-hover-bg: #f6f6f6; --input-bg: #fff; --input-border: #ddd;
        --link-color: #007aff; --focus-ring: rgba(0, 122, 255, 0.35);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg-color: #121212; --text-color: #eee; --muted-color: #9a9a9a; --border-color: #333;
          --card-bg: #1e1e1e; --card-hover-bg: #2a2a2a; --input-bg: #2a2a2a; --input-border: #444;
          --link-color: #09f; --focus-ring: rgba(0, 153, 255, 0.4);
        }
      }
      html { -webkit-text-size-adjust: 100%; }
      body {
        background-color: var(--bg-color); color: var(--text-color);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        margin: 0; padding: 0;
        /* A phone's notch is not a place to put a card. */
        padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right);
      }
      a { color: var(--link-color); }
    </style>
    ${cssFiles.map(file => `<link rel="stylesheet" href="${escapeHtml(file)}">`).join('\n')}
    ${scriptTags}
  </head>
  <body>
    <div id="root"></div>
    <div style="display: none;" aria-hidden="true">
      This is a Single Page Application. Agents should read
      <a href="/llms.txt">/llms.txt</a> for an index of every card, or
      <a href="/agents.md">/agents.md</a> (<a href="/agents.html">/agents.html</a>)
      for the whole deck as one document.
    </div>
    <script type="module">
      import { renderDeck } from '${entryFile}';
      renderDeck({
        target: document.getElementById('root'),
        initialCardsData: ${escapeJson(initialCardsData)},
        pinnedCardPaths: ${escapeJson(pinnedCardPaths ?? [])},
        searchIndexUrl: ${escapeJson(searchIndexUrl)},
        dev: ${dev ? 'true' : 'false'},
      });
    </script>
  </body>
</html>
`;
}
