#!/usr/bin/env node

import {build as viteBuild} from 'vite';
import fs from 'fs-extra';
import path from 'path';
import {globSync} from 'glob';
import {createRequire} from 'module';

const require = createRequire(import.meta.url);

// --- Path Resolution ---
// Resolve paths relative to the user's project, but find reel's own source for bundling.
const userRoot = process.cwd();
const outDir = path.resolve(userRoot, 'out');
const assetsDir = path.resolve(outDir, 'assets');
const reelPluginPath = require.resolve('@3sln/reel/vite-plugin');
const reelRoot = path.dirname(reelPluginPath);

// --- Main Build Function ---
async function build() {
  try {
    console.log('Starting Reel build...');

    // 1. Clean output directory
    await fs.emptyDir(outDir);
    console.log(`Cleaned ${outDir}`);

    // 2. Bundle the reel application using Vite's JS API
    console.log('Bundling application assets...');
    await viteBuild({
      configFile: false, // Don't look for a vite.config.js in the user's project
      root: reelRoot, // The root for this build is the reel package itself
      build: {
        outDir: assetsDir,
        manifest: true,
        lib: {
          entry: path.resolve(reelRoot, 'src/main.js'),
          name: 'ReelApp',
          fileName: 'reel-app',
          formats: ['es'],
        },
      },
    });
    console.log('Application assets bundled.');

    const userPkgJsonPath = path.resolve(userRoot, 'package.json');
    const userPkgJson = fs.existsSync(userPkgJsonPath) ? await fs.readJson(userPkgJsonPath) : {};
    const options = userPkgJson['@3sln/reel'] || {};

    // 3. Find and copy all project files based on globs
    const defaultIgnore = [
      '**/node_modules/**',
      `**/${path.basename(outDir)}/**`,
      '**/package.json',
      '**/package-lock.json',
      '**/vite.config.js',
      '**/.git/**',
    ];

    const include = options.build?.include || ['**/*'];
    const exclude = options.build?.exclude || defaultIgnore;

    console.log('Copying project files...');
    const filesToCopy = globSync(include, {
      cwd: userRoot,
      ignore: exclude,
      nodir: true,
      dot: true,
    });

    for (const file of filesToCopy) {
      const source = path.resolve(userRoot, file);
      const dest = path.resolve(outDir, file);
      await fs.ensureDir(path.dirname(dest));
      await fs.copy(source, dest);
    }
    console.log(`Copied ${filesToCopy.length} files.`);

    // 4. Find card paths for the index
    const cardPaths = filesToCopy.filter(file => file.endsWith('.md') || file.endsWith('.html'));
    console.log(`Found ${cardPaths.length} cards.`);

    // 5. Generate the final index.html
    console.log('Generating production index.html...');
    const manifest = await fs.readJson(path.resolve(assetsDir, '.vite/manifest.json'));
    const entryFile = manifest['src/main.js']?.file;
    const cssFiles = manifest['src/main.js']?.css || [];

    if (!entryFile) {
      throw new Error('Could not find entry file in Vite manifest.');
    }

    const title = options.build?.title || options.title || 'Reel';
    const importMap = options.build?.importMap || options.importMap;
    const pinned = options.build?.pinned || options.pinned || [];

    const html = `
            <!doctype html>
            <html lang="en">
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale-1">
                <title>${title}</title>
                ${importMap ? `<script type="importmap">${JSON.stringify(importMap)}</script>` : ''}
                <script>
                  window.__INITIAL_CARD_PATHS__ = ${JSON.stringify(cardPaths)};
                  window.__PINNED_CARD_PATHS__ = ${JSON.stringify(pinned)};
                </script>
                <style>
                  :root {
                    --bg-color: #fff; --text-color: #222; --border-color: #eee; --card-bg: #fff;
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
                    import { renderReel } from '/assets/${entryFile}';
                    renderReel({
                        target: document.getElementById('root'),
                        initialCardPaths: window.__INITIAL_CARD_PATHS__,
                        pinnedCardPaths: window.__PINNED_CARD_PATHS__,
                    });
                </script>
              </body>
            </html>
        `;

    await fs.writeFile(path.resolve(outDir, 'index.html'), html);
    console.log('Production index.html generated.');
    console.log('Build complete!');
  } catch (e) {
    console.error('Reel build failed:', e);
    process.exit(1);
  }
}

build();
