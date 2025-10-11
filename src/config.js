import fs from 'fs-extra';
import path from 'path';
import { globSync } from 'glob';
import { subtle } from 'crypto';

export async function sha256(str) {
  const textAsBuffer = new TextEncoder().encode(str);
  const hashBuffer = await subtle.digest('SHA-256', textAsBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function loadDeckConfig(root) {
    const userPkgJsonPath = path.resolve(root, 'package.json');
    const userPkgJson = fs.existsSync(userPkgJsonPath) ? await fs.readJson(userPkgJsonPath) : {};
    const options = userPkgJson['@3sln/deck'] || {};

    const defaultConfig = {
        title: 'Deck',
        pinned: [],
        pick: {},
        include: ['**/*'],
        exclude: [
            '**/node_modules/**',
            'out/**',
            `**/${path.basename(path.resolve(root, 'out'))}/**`,
            '**/package.json',
            '**/package-lock.json',
            '**/vite.config.js',
            '**/.git/**',
        ],
    };

    const baseConfig = { ...defaultConfig, ...options };

    return {
        ...baseConfig,
        dev: { ...baseConfig, ...(options.dev || {}) },
        build: { ...baseConfig, ...(options.build || {}) },
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

export function getHtmlTemplate({ title, importMap, initialCardsData, pinnedCardPaths, entryFile, cssFiles = [] }) {
  return `
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>${title}</title>
            ${importMap ? `<script type="importmap">${JSON.stringify(importMap)}</script>` : ''}
            <script>
              window.__INITIAL_CARDS_DATA__ = ${JSON.stringify(initialCardsData)};
              window.__PINNED_CARD_PATHS__ = ${JSON.stringify(pinnedCardPaths)};
            </script>
            <style>
              :root { --bg-color: #fff; --text-color: #222; --border-color: #eee; --card-bg: #fff;
                --card-hover-bg: #f9f9f9; --input-bg: #fff; --input-border: #ddd; --link-color: #007aff;
              }
              @media (prefers-color-scheme: dark) {
                :root {
                  --bg-color: #121212; --text-color: #eee; --border-color: #333; --card-bg: #1e1e1e;
                  --card-hover-bg: #2a2a2a; --input-bg: #2a2a2a; --input-border: #444; --link-color: #09f;
                }
              }
              body {
                background-color: var(--bg-color); color: var(--text-color);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                margin: 0; padding: 0;
              }
            </style>
            ${cssFiles.map(file => `<link rel="stylesheet" href="/assets/${file}">`).join('\n')}
          </head>
          <body>
            <div id="root"></div>
            <script type="module">
              import { renderDeck } from '${entryFile}';
              renderDeck({
                target: document.getElementById('root'),
                initialCardsData: window.__INITIAL_CARDS_DATA__,
                pinnedCardPaths: window.__PINNED_CARD_PATHS__,
              });
            </script>
          </body>
        </html>
    `;
}
