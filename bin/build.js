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
import {createArtifacts, describeCard, encodePath, MANIFEST_FILE} from '../src/artifacts.js';
import {INDEX_FILE} from '../src/search-index.js';
import {demoBuildOptions} from '../src/dev-core.js';
import {robotsTxt, sitemapXml, llmsTxt} from '../src/discovery.js';
import {demoTagsIn, withAttribute} from '../src/demo-tags.js';
import {stripFrontMatter} from '../src/frontmatter.js';

const userRoot = process.cwd();
const deckRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const DEMO_BUNDLE_DIR = 'assets/demos';

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative)
  );
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
  const esbuild = await import('esbuild');
  let result = content;

  for (const {tag, attributes} of demoTagsIn(content)) {
    const src = attributes.src;
    if (!src) continue;

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

    // An author who set their own `canonical-src` keeps it — that is the whole
    // point of the attribute, and it is what the Source panel shows. Only when
    // there is none does the original `src` become the canonical one.
    let rewritten = withAttribute(tag, 'src', outFile);
    if (!attributes['canonical-src']) {
      rewritten = withAttribute(rewritten, 'canonical-src', src);
    }
    result = result.replace(tag, rewritten);
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
  for (const {tag, index, attributes} of demoTagsIn(content)) {
    // The source a reader would want is the one the demo was written in, which
    // is exactly what `canonical-src` names when it is there.
    const src = attributes['canonical-src'] ?? attributes.src;
    if (!src) continue;

    const relativePath = src.startsWith('/') ? src.slice(1) : src;
    const demoFilePath = path.resolve(outDir, relativePath);

    if (!isInside(outDir, demoFilePath) || !(await fs.pathExists(demoFilePath))) {
      console.warn(`Warning: could not find demo file for ${src}`);
      continue;
    }
    if (!isInside(outDir, await fs.realpath(demoFilePath))) continue;
    const demoContent = await fs.readFile(demoFilePath, 'utf-8');
    replacements.push({
      start: index,
      end: index + tag.length,
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
  const stockUi = buildConfig.ui !== false;
  const realOutput = (await fs.pathExists(outDir)) ? await fs.realpath(outDir) : outDir;
  if (realOutput === userRoot || isInside(realOutput, userRoot)) {
    throw new Error('The output directory cannot contain the project root');
  }

  const outsideOutput = file => !isInside(outDir, path.resolve(userRoot, file));
  const filesToCopy = getProjectFiles(userRoot, buildConfig).filter(outsideOutput);
  const cardFiles = getCardFiles(userRoot, buildConfig).filter(outsideOutput).sort();
  await fs.emptyDir(outDir);
  console.log(`Cleaned ${outDir}`);

  console.log('Copying project files...');
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
      if (destPath !== outDir && !isInside(outDir, destPath)) {
        throw new Error(`Picked destination must stay in the output directory: ${dest}`);
      }
      if (await fs.pathExists(sourcePath)) {
        console.log(`Picking '${source}' to '${dest}'...`);
        await fs.copy(sourcePath, destPath, {dereference: true});
      } else {
        console.warn(`Source path for 'pick' not found: ${sourcePath}`);
      }
    }
  }

  let agentsIndex =
    '# Agents Index\n\n' +
    'This file contains the concatenated content of all cards to help LLMs ' +
    'understand the available documentation.\n\n';

  const cards = [];
  const bundledDemos = new Map();
  const reserved = new Set(['agents.md', 'agents.html', ...(stockUi ? ['index.html'] : [])]);
  let cardDir = 'deck-content';
  while (await fs.pathExists(path.join(outDir, cardDir))) cardDir += '-cards';
  for (const file of cardFiles) {
    const filePath = path.resolve(outDir, file);
    const raw = await fs.readFile(filePath, 'utf-8');

    const served = await bundleDemos(raw, {
      userRoot,
      outDir,
      bundled: bundledDemos,
      esbuildOptions: buildConfig.esbuild,
    });
    const contentUrl = reserved.has(file) ? `./${cardDir}/${encodePath(file)}` : undefined;
    if (contentUrl) await fs.outputFile(path.resolve(outDir, cardDir, file), served);
    else if (served !== raw) await fs.writeFile(filePath, served);
    const card = await describeCard(file, served, contentUrl);
    cards.push(card);
    const body = card.format === 'markdown' ? stripFrontMatter(raw) : raw;
    agentsIndex += `\n\n---\n\n# ${card.title} (${card.path})\n\n${await inlineDemos(body, outDir)}`;
  }
  console.log(`Found and processed ${cards.length} cards.`);
  if (bundledDemos.size > 0) {
    console.log(`Bundled ${bundledDemos.size} demo module(s).`);
  }
  const {manifest, index} = createArtifacts(cards, buildConfig);

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
    robotsTxt({title: buildConfig.title, url: buildConfig.url, ui: stockUi}),
  );
  await fs.writeFile(
    path.resolve(outDir, 'llms.txt'),
    llmsTxt({
      title: buildConfig.title,
      description: buildConfig.description,
      url: buildConfig.url,
      cards: manifest.cards,
    }),
  );
  if (buildConfig.url) {
    const showsPublishedVersion =
      buildConfig.defaultVersion == null ||
      buildConfig.defaultVersion === (buildConfig.version ?? 'current');
    await fs.writeFile(
      path.resolve(outDir, 'sitemap.xml'),
      sitemapXml({
        url: buildConfig.url,
        cards: manifest.cards,
        ui: stockUi && showsPublishedVersion,
      }),
    );
    console.log(`Sitemap written for ${buildConfig.url}.`);
  } else {
    console.log('No `url` in the deck config, so no sitemap; robots.txt names none.');
  }

  // The UI and headless clients share this catalog and precompiled index.
  console.log('Building search index...');
  await fs.writeJson(path.resolve(outDir, MANIFEST_FILE), manifest);
  await fs.writeJson(path.resolve(outDir, INDEX_FILE), index);
  const indexBytes = (await fs.stat(path.resolve(outDir, INDEX_FILE))).size;
  console.log(
    `Search index: ${cards.length} cards, ${Object.keys(index.terms).length} terms, ` +
      `${(indexBytes / 1024).toFixed(1)} kB.`,
  );

  if (!stockUi) {
    console.log('Data-only build complete.');
    return;
  }

  const {entryFile, outputs} = await bundleApp(assetsDir);
  await fs.writeJson(path.resolve(outDir, 'asset-manifest.json'), {
    files: ['./', './index.html', ...outputs.map(file => '.' + file)],
  });

  const html = getHtmlTemplate({
    ...buildConfig,
    manifestUrl: './' + MANIFEST_FILE,
    entryFile: '.' + entryFile,
    serviceWorkerUrl: './sw.js',
  });
  const revision = await sha256(html);
  const worker = await fs.readFile(path.resolve(deckRoot, 'src/sw.js'), 'utf8');
  await fs.writeFile(
    path.resolve(outDir, 'sw.js'),
    worker.replace('DECK_SHELL_REVISION', revision),
  );
  await fs.writeFile(path.resolve(outDir, 'index.html'), html);

  console.log('Build complete!');
}

build().catch(err => {
  console.error('Deck build failed:', err);
  process.exit(1);
});
