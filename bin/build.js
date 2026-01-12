#!/usr/bin/env node

import {build as viteBuild} from 'vite';
import fs from 'fs-extra';
import path from 'path';
import {createRequire} from 'module';
import { sha256, loadDeckConfig, getProjectFiles, getCardFiles, getHtmlTemplate } from '../src/config.js';

import {marked} from 'marked';
const require = createRequire(import.meta.url);

// --- Path Resolution ---
const userRoot = process.cwd();
// outDir is now resolved inside build()
const deckPluginPath = require.resolve('@3sln/deck/vite-plugin');
const deckRoot = path.dirname(deckPluginPath);

// --- Main Build Function ---
async function build() {
  try {
    console.log('Starting Deck build...');

    const config = await loadDeckConfig(userRoot);
    const buildConfig = config.build || {};

    const outDir = path.resolve(userRoot, buildConfig.outDir || 'out');
    const assetsDir = path.resolve(outDir, 'assets');

    // Clean output directory
    await fs.emptyDir(outDir);
    console.log(`Cleaned ${outDir}`);

    // Bundle the deck application using Vite's JS API
    console.log('Bundling application assets...');
    const viteManifest = await viteBuild({
      configFile: false,
      root: deckRoot,
      build: {
        outDir: assetsDir,
        manifest: true,
        lib: {
          entry: path.resolve(deckRoot, 'src/main.js'),
          name: 'DeckApp',
          fileName: 'deck-app',
          formats: ['es'],
        },
      },
    });
    console.log('Application assets bundled.');

    // Find and copy all project files
    console.log('Copying project files...');
    const filesToCopy = getProjectFiles(userRoot, buildConfig);
    for (const file of filesToCopy) {
      const source = path.resolve(userRoot, file);
      const dest = path.resolve(outDir, file);
      await fs.ensureDir(path.dirname(dest));
      await fs.copy(source, dest);
    }
    console.log(`Copied ${filesToCopy.length} files.`);

    // Copy picked static assets
    console.log('Copying picked assets...');
    if (buildConfig.pick) {
        for (const [source, dest] of Object.entries(buildConfig.pick)) {
            const sourcePath = path.resolve(userRoot, source);
            const destPath = path.resolve(outDir, dest);
            if (fs.existsSync(sourcePath)) {
                console.log(`Picking '${source}' to '${dest}'...`);
                await fs.copy(sourcePath, destPath, { dereference: true });
            } else {
                console.warn(`Source path for 'pick' not found: ${sourcePath}`);
            }
        }
    }

    // Find card paths and hash content for the index
    const cardFiles = getCardFiles(userRoot, buildConfig);
    
    let allCardsContent = "# Agents Index\n\nThis file contains the concatenated content of all cards to help LLMs understand the available documentation.\n\n";

    const initialCardsData = await Promise.all(cardFiles.map(async (file) => {
        const filePath = path.resolve(outDir, file);
        let content = await fs.readFile(filePath, 'utf-8');
        const hash = await sha256(content);

        // Extract title
        const tokens = marked.lexer(content);
        const heading = tokens.find(t => t.type === 'heading' && t.depth === 1);
        const title = heading ? heading.text : path.basename(file, path.extname(file));

        // Process deck-demo tags
        const demoRegex = /<deck-demo\s+[^>]*src="([^"]+)"[^>]*><\/deck-demo>/g;
        // Use a loop or replace with async handling if possible, but replace expects sync.
        // Since we are inside an async map, we can process matches before appending.
        
        let match;
        const replacements = [];
        while ((match = demoRegex.exec(content)) !== null) {
            const fullTag = match[0];
            const src = match[1];
            try {
                // src is typically absolute web path like /demos/foo.js. Remove leading slash for filesystem resolve.
                const relativePath = src.startsWith('/') ? src.slice(1) : src;
                const demoFilePath = path.resolve(outDir, relativePath);
                
                if (await fs.exists(demoFilePath)) {
                    const demoContent = await fs.readFile(demoFilePath, 'utf-8');
                    const replacement = `\n\n### Demo Code (${src})\n\n\`\`\`javascript\n${demoContent}\n\`\`\`\n\n`;
                    replacements.push({start: match.index, end: match.index + fullTag.length, replacement});
                } else {
                     console.warn(`Warning: Could not find demo file: ${demoFilePath}`);
                }
            } catch (err) {
                console.warn(`Error processing demo ${src}:`, err);
            }
        }

        // Apply replacements in reverse order to preserve indices
        for (let i = replacements.length - 1; i >= 0; i--) {
            const {start, end, replacement} = replacements[i];
            content = content.substring(0, start) + replacement + content.substring(end);
        }

        allCardsContent += `\n\n---\n\n# ${title} (/${file})\n\n${content}`;

        return { path: `/${file}`, hash, title };
    }));
    console.log(`Found and processed ${initialCardsData.length} cards.`);

    // Write agents.md
    console.log('Generating agents.md...');
    await fs.writeFile(path.resolve(outDir, 'agents.md'), allCardsContent);
    console.log('agents.md generated.');

    // Write agents.html
    console.log('Generating agents.html...');
    const agentsHtmlContent = marked.parse(allCardsContent);
    const agentsHtml = `<!doctype html>
<html>
<head>
  <title>Agents Index</title>
</head>
<body>
${agentsHtmlContent}
</body>
</html>`;
    await fs.writeFile(path.resolve(outDir, 'agents.html'), agentsHtml);
    console.log('agents.html generated.');

    // Generate asset manifest for service worker
    console.log('Generating asset manifest...');
    const manifest = await fs.readJson(path.resolve(assetsDir, '.vite/manifest.json'));
    const bundledAssets = Object.values(manifest).flatMap(chunk => [chunk.file, ...(chunk.css || [])]).map(file => `/assets/${file}`);
    const assetManifest = {
        files: [...filesToCopy.map(f => `/${f}`), ...bundledAssets]
    };
    await fs.writeJson(path.resolve(outDir, 'asset-manifest.json'), assetManifest);
    console.log('Asset manifest generated.');

    // Copy service worker
    await fs.copy(path.resolve(deckRoot, 'src/sw.js'), path.resolve(outDir, 'sw.js'));

    // Generate the final index.html
    console.log('Generating production index.html...');
    const entryFile = manifest['src/main.js']?.file;
    const cssFiles = manifest['src/main.js']?.css || [];

    if (!entryFile) {
      throw new Error('Could not find entry file in Vite manifest.');
    }

    const html = getHtmlTemplate({
        title: buildConfig.title,
        importMap: buildConfig.importMap,
        initialCardsData,
        pinnedCardPaths: buildConfig.pinned,
        entryFile: `/assets/${entryFile}`,
        cssFiles,
        favicon: buildConfig.favicon,
        scripts: buildConfig.scripts,
        stylesheets: buildConfig.stylesheets,
    });

    await fs.writeFile(path.resolve(outDir, 'index.html'), html);
    console.log('Production index.html generated.');
    console.log('Build complete!');
  } catch (e) {
    console.error('Deck build failed:', e);
    process.exit(1);
  }
}

build();
