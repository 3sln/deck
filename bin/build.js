#!/usr/bin/env node

/**
 * Builds a published deck: a static directory that any file server can host.
 *
 * The app is bundled with esbuild rather than with Vite. Deck used to be a Vite
 * plugin and could reasonably lean on Vite for both jobs; now that a deck can
 * be developed under @web/dev-server just as well, requiring the whole of Vite
 * to *publish* one would be a dependency nobody asked for. Deck's own client
 * source is plain ESM for the same reason — see `bin/vendor-themes.js`.
 */

import * as esbuild from 'esbuild';
import fs from 'fs-extra';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {marked} from 'marked';

import {
  sha256,
  loadDeckConfig,
  getProjectFiles,
  getCardFiles,
  getHtmlTemplate,
  toWebPath,
} from '../src/config.js';
import {extractCard} from '../src/card-text.js';
import {scoreCard} from '../src/tokenize.js';
import {encodeIndex, INDEX_FILE} from '../src/search-index.js';
import {demoBuildOptions} from '../src/dev-core.js';
import {robotsTxt, sitemapXml, llmsTxt} from '../src/discovery.js';

const userRoot = process.cwd();
const deckRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const DEMO_TAG = /<deck-demo\s+[^>]*src="([^"]+)"[^>]*><\/deck-demo>/g;
const FENCE = /^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1\2[^\n]*$/gm;
const DEMO_BUNDLE_DIR = 'assets/demos';

/**
 * The demo tags a card actually embeds — not the ones it merely writes about.
 *
 * A card documenting `<deck-demo>` shows the tag in a fenced code block, and a
 * naive scan treats that example as a real embed: it warns that the file is
 * missing and, worse, would rewrite the example the reader is meant to copy.
 */
function demoTagsIn(content) {
  const fences = [...content.matchAll(FENCE)].map(m => [m.index, m.index + m[0].length]);
  const inFence = index => fences.some(([start, end]) => index >= start && index < end);
  return [...content.matchAll(DEMO_TAG)].filter(match => !inFence(match.index));
}

/**
 * Bundles every demo module a card references, and points the card at the
 * bundle.
 *
 * A demo is ordinary application code and imports the way application code
 * does — `import * as d from '@3sln/dodo'`. In dev that works because the dev
 * server bundles demos on request; published, the browser was handed the file
 * as written and refused it, because a bare specifier means nothing to a
 * browser. The demo panel showed "Could not load demo module" and the card
 * around it looked fine, which is why this survived as long as it did.
 *
 * The original file is still copied and still what the Source panel shows —
 * that is what `canonical-src` is for. Readers see the code that was written,
 * not the code that was bundled.
 */
async function bundleDemos(content, {userRoot, outDir, bundled, esbuildOptions}) {
  let result = content;

  for (const match of demoTagsIn(content)) {
    const src = match[1];
    if (match[0].includes('canonical-src=')) continue;

    const relative = src.replace(/^\//, '');
    const entry = path.resolve(userRoot, relative);
    if (!(await fs.pathExists(entry))) {
      console.warn(`Warning: <deck-demo src="${src}"> does not exist; leaving it as written.`);
      continue;
    }

    const outFile = `/${DEMO_BUNDLE_DIR}/${relative.replace(/[\\/]/g, '__')}`;
    if (!bundled.has(src)) {
      await esbuild.build({
        entryPoints: [entry],
        absWorkingDir: userRoot,
        outfile: path.resolve(outDir, outFile.replace(/^\//, '')),
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: ['es2022'],
        minify: true,
        logOverride: {'unsupported-dynamic-import': 'silent'},
        ...demoBuildOptions(esbuildOptions),
      });
      bundled.set(src, outFile);
    }

    const rewritten = match[0].replace(`src="${src}"`, `src="${outFile}" canonical-src="${src}"`);
    result = result.replace(match[0], rewritten);
  }

  return result;
}

/**
 * Replaces `<deck-demo>` tags with the demo's source, for the agent index.
 *
 * A card that says "here is a live demo" is useless to something that cannot
 * run one. Inlining the script is what makes `agents.md` a complete account of
 * the deck rather than a table of contents with holes in it.
 */
async function inlineDemos(content, outDir) {
  const replacements = [];
  for (const match of demoTagsIn(content)) {
    const src = match[1];
    const relativePath = src.startsWith('/') ? src.slice(1) : src;
    const demoFilePath = path.resolve(outDir, relativePath);

    if (!(await fs.pathExists(demoFilePath))) {
      console.warn(`Warning: could not find demo file for ${src}`);
      continue;
    }
    const demoContent = await fs.readFile(demoFilePath, 'utf-8');
    replacements.push({
      start: match.index,
      end: match.index + match[0].length,
      replacement: `\n\n### Demo Code (${src})\n\n\`\`\`javascript\n${demoContent}\n\`\`\`\n\n`,
    });
  }

  // Applied back to front so an earlier replacement cannot move a later index.
  let result = content;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const {start, end, replacement} = replacements[i];
    result = result.slice(0, start) + replacement + result.slice(end);
  }
  return result;
}

async function bundleApp(assetsDir) {
  const result = await esbuild.build({
    entryPoints: [path.resolve(deckRoot, 'src/main.js')],
    absWorkingDir: deckRoot,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    metafile: true,
    outdir: assetsDir,
    entryNames: 'deck-app-[hash]',
    // A demo module's URL is only known at runtime, and deck's dev channel only
    // exists under a dev server. Both are meant to stay outside the bundle.
    logOverride: {'unsupported-dynamic-import': 'silent'},
  });

  const entry = Object.entries(result.metafile.outputs).find(([, output]) => output.entryPoint);
  if (!entry) throw new Error('esbuild produced no entry chunk for the deck app.');

  const outputs = Object.keys(result.metafile.outputs).map(file =>
    toWebPath(path.relative(path.dirname(assetsDir), path.resolve(deckRoot, file))),
  );

  return {
    entryFile: toWebPath(path.relative(path.dirname(assetsDir), path.resolve(deckRoot, entry[0]))),
    outputs,
  };
}

async function build() {
  console.log('Starting Deck build...');

  const config = await loadDeckConfig(userRoot);
  const buildConfig = config.build;

  const outDir = path.resolve(userRoot, buildConfig.outDir);
  const assetsDir = path.resolve(outDir, 'assets');

  await fs.emptyDir(outDir);
  console.log(`Cleaned ${outDir}`);

  console.log('Bundling application assets...');
  const {entryFile, outputs} = await bundleApp(assetsDir);
  console.log(`Application bundled to ${entryFile}`);

  console.log('Copying project files...');
  const filesToCopy = getProjectFiles(userRoot, buildConfig);
  for (const file of filesToCopy) {
    const source = path.resolve(userRoot, file);
    const dest = path.resolve(outDir, file);
    await fs.ensureDir(path.dirname(dest));
    await fs.copy(source, dest);
  }
  console.log(`Copied ${filesToCopy.length} files.`);

  if (buildConfig.pick && Object.keys(buildConfig.pick).length > 0) {
    console.log('Copying picked assets...');
    for (const [source, dest] of Object.entries(buildConfig.pick)) {
      const sourcePath = path.resolve(userRoot, source);
      const destPath = path.resolve(outDir, dest);
      if (await fs.pathExists(sourcePath)) {
        console.log(`Picking '${source}' to '${dest}'...`);
        await fs.copy(sourcePath, destPath, {dereference: true});
      } else {
        console.warn(`Source path for 'pick' not found: ${sourcePath}`);
      }
    }
  }

  const cardFiles = getCardFiles(userRoot, buildConfig);
  let agentsIndex =
    '# Agents Index\n\n' +
    'This file contains the concatenated content of all cards to help LLMs ' +
    'understand the available documentation.\n\n';

  const cards = [];
  const bundledDemos = new Map();
  for (const file of cardFiles) {
    const filePath = path.resolve(outDir, file);
    const raw = await fs.readFile(filePath, 'utf-8');

    // The agent index gets the card as written, demo sources and all. The
    // browser gets a copy whose demo tags point at bundles.
    agentsIndex += `\n\n---\n\n# ${extractCard(file, raw).title} (${toWebPath(file)})\n\n${await inlineDemos(raw, outDir)}`;

    const served = await bundleDemos(raw, {
      userRoot,
      outDir,
      bundled: bundledDemos,
      esbuildOptions: buildConfig.esbuild,
    });
    if (served !== raw) await fs.writeFile(filePath, served);

    // Hashed and indexed from what is actually served, so the browser's copy
    // and the index describe the same bytes.
    const hash = await sha256(served);
    const {title, summary, text} = extractCard(file, served);

    cards.push({
      path: toWebPath(file),
      hash,
      title,
      summary,
      scores: scoreCard({title, summary, body: text}),
    });
  }
  console.log(`Found and processed ${cards.length} cards.`);
  if (bundledDemos.size > 0) {
    console.log(`Bundled ${bundledDemos.size} demo module(s).`);
  }

  console.log('Writing agents.md and agents.html...');
  await fs.writeFile(path.resolve(outDir, 'agents.md'), agentsIndex);
  await fs.writeFile(
    path.resolve(outDir, 'agents.html'),
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Agents Index</title>
</head>
<body>
${marked.parse(agentsIndex)}
</body>
</html>`,
  );

  // A deck is a single-page application, so a crawler or an agent that does not
  // run JavaScript sees an empty page. These say where the content really is.
  console.log('Writing robots.txt and llms.txt...');
  await fs.writeFile(
    path.resolve(outDir, 'robots.txt'),
    robotsTxt({title: buildConfig.title, url: buildConfig.url}),
  );
  await fs.writeFile(
    path.resolve(outDir, 'llms.txt'),
    llmsTxt({
      title: buildConfig.title,
      description: buildConfig.description,
      url: buildConfig.url,
      cards,
    }),
  );
  if (buildConfig.url) {
    await fs.writeFile(
      path.resolve(outDir, 'sitemap.xml'),
      sitemapXml({url: buildConfig.url, cards}),
    );
    console.log(`Sitemap written for ${buildConfig.url}.`);
  } else {
    console.log('No `url` in the deck config, so no sitemap; robots.txt names none.');
  }

  // The precompiled index. The browser downloads this before any card, which is
  // what lets the very first search cover the whole deck instead of covering
  // whatever happened to have finished downloading.
  console.log('Building search index...');
  const searchIndex = encodeIndex(cards);
  await fs.writeJson(path.resolve(outDir, INDEX_FILE), searchIndex);
  const indexBytes = (await fs.stat(path.resolve(outDir, INDEX_FILE))).size;
  console.log(
    `Search index: ${cards.length} cards, ${Object.keys(searchIndex.terms).length} terms, ` +
      `${(indexBytes / 1024).toFixed(1)} kB.`,
  );

  console.log('Generating asset manifest...');
  await fs.writeJson(path.resolve(outDir, 'asset-manifest.json'), {
    files: [...filesToCopy.map(toWebPath), ...outputs, ...bundledDemos.values(), `/${INDEX_FILE}`],
  });

  await fs.copy(path.resolve(deckRoot, 'src/sw.js'), path.resolve(outDir, 'sw.js'));

  console.log('Generating production index.html...');
  await fs.writeFile(
    path.resolve(outDir, 'index.html'),
    getHtmlTemplate({
      title: buildConfig.title,
      description: buildConfig.description,
      importMap: buildConfig.importMap,
      initialCardsData: cards.map(({path: cardPath, hash}) => ({path: cardPath, hash})),
      pinnedCardPaths: buildConfig.pinned,
      entryFile,
      favicon: buildConfig.favicon,
      scripts: buildConfig.scripts,
      stylesheets: buildConfig.stylesheets,
      searchIndexUrl: `/${INDEX_FILE}`,
      dev: false,
    }),
  );

  console.log('Build complete!');
}

build().catch(err => {
  console.error('Deck build failed:', err);
  process.exit(1);
});
