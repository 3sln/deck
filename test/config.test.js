import {test, expect, beforeAll, afterAll} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadDeckConfig, getCardFiles, getProjectFiles, getHtmlTemplate} from '../src/config.js';
import {extractCard} from '../src/card-text.js';
import {
  parseVirtualUrl,
  ESM_PREFIX,
  SRC_PREFIX,
  SRC_SUFFIX,
  BUNDLE_PREFIX,
} from '../src/dev-core.js';

let root;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-test-'));
  await fs.mkdir(path.join(root, 'cards'), {recursive: true});
  await fs.mkdir(path.join(root, 'build-output', 'cards'), {recursive: true});
  await fs.mkdir(path.join(root, 'node_modules', 'x'), {recursive: true});

  await fs.writeFile(path.join(root, 'cards/one.md'), '# One\n\nFirst card.\n');
  await fs.writeFile(path.join(root, 'cards/two.html'), '<h1>Two</h1><p>Second card.</p>');
  await fs.writeFile(path.join(root, 'cards/notes.txt'), 'not a card');
  await fs.writeFile(path.join(root, 'build-output/cards/stale.md'), '# Stale\n');
  await fs.writeFile(path.join(root, 'node_modules/x/index.md'), '# Vendored\n');
  await fs.writeFile(path.join(root, 'bun.lock'), '{}');
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({name: 'x', '@3sln/deck': {title: 'T', outDir: 'build-output'}}),
  );
});

afterAll(async () => {
  await fs.rm(root, {recursive: true, force: true});
});

test('a custom outDir excludes itself', async () => {
  const config = await loadDeckConfig(root);
  const cards = getCardFiles(root, config.build);
  // Without this the previous build's output is copied back in as content, and
  // the deck grows a stale duplicate of itself on every build.
  expect(cards.some(file => file.includes('build-output'))).toBe(false);
  expect(cards.sort()).toEqual(['cards/one.md', 'cards/two.html']);
});

test('node_modules, lockfiles and package.json are never content', async () => {
  const config = await loadDeckConfig(root);
  const files = getProjectFiles(root, config.build);
  expect(files.some(f => f.includes('node_modules'))).toBe(false);
  expect(files).not.toContain('package.json');
  expect(files).not.toContain('bun.lock');
  expect(files).toContain('cards/notes.txt');
});

test('dev and build inherit the shared config', async () => {
  const config = await loadDeckConfig(root);
  expect(config.dev.title).toBe('T');
  expect(config.build.title).toBe('T');
  expect(config.build.outDir).toBe('build-output');
});

test('a Markdown card yields its title, summary and text', () => {
  const {title, summary, text} = extractCard(
    'cards/one.md',
    '# The `<deck-demo>` Element\n\nEmbeds a demo.\n\n- a list item\n\n```js\nconst x = 1;\n```\n',
  );
  expect(title).toBe('The <deck-demo> Element');
  expect(summary).toBe('Embeds a demo.');
  expect(text).toContain('a list item');
  expect(text).toContain('const x = 1');
});

test('an HTML card yields the same three things', () => {
  const {title, summary, text} = extractCard(
    'cards/two.html',
    '<h1>Two</h1><p>Second card.</p><script>ignored()</script><p>More.</p>',
  );
  expect(title).toBe('Two');
  expect(summary).toBe('Second card.');
  expect(text).toContain('More.');
  expect(text).not.toContain('ignored');
});

test('a card with no heading falls back to its file name', () => {
  expect(extractCard('cards/no-heading.md', 'Just prose.\n').title).toBe('no-heading');
});

test('inline script data cannot break out of the page', () => {
  const html = getHtmlTemplate({
    title: 'A </title> title',
    initialCardsData: [{path: '/</script><img src=x onerror=alert(1)>.md', hash: 'h'}],
    pinnedCardPaths: [],
    entryFile: '/app.js',
  });
  expect(html).not.toContain('</script><img');
  expect(html).toContain('\\u003c/script>');
  expect(html).not.toContain('<title>A </title> title</title>');
});

test('the dev flag and index URL reach the client', () => {
  const dev = getHtmlTemplate({
    initialCardsData: [],
    entryFile: '/app.js',
    dev: true,
  });
  expect(dev).toContain('dev: true');
  expect(dev).toContain('searchIndexUrl: null');

  const published = getHtmlTemplate({
    initialCardsData: [],
    entryFile: '/app.js',
    searchIndexUrl: '/deck-search-index.json',
  });
  expect(published).toContain('dev: false');
  expect(published).toContain('"/deck-search-index.json"');
});

test('the generated dev module URLs round-trip a card path', () => {
  const target = '/demos/my demo.js';
  const encoded = encodeURIComponent(target);

  expect(parseVirtualUrl(`${ESM_PREFIX}${encoded}`)).toEqual({kind: 'esm', target});
  expect(parseVirtualUrl(`${SRC_PREFIX}${encoded}${SRC_SUFFIX}`)).toEqual({kind: 'src', target});
  expect(parseVirtualUrl(`${BUNDLE_PREFIX}${encoded}?v=3`)).toEqual({kind: 'bundle', target});
  expect(parseVirtualUrl('/cards/one.md')).toBeNull();
});

test('a source URL round-trips whatever extension the file has', () => {
  // Every deck demo deck ships is a .js file, which is how a `canonical-src`
  // pointing at ClojureScript went unnoticed: the request has to end in `.js`
  // or Vite routes it to static file serving and answers 404, but the path
  // inside it must survive intact.
  for (const target of [
    '/demos/counter-demo.js',
    '/demos/custom-dodo/custom-dodo.cljs',
    '/demos/a.ts',
    '/demos/no-extension',
    '/demos/dots.in.name.mjs',
  ]) {
    const url = `${SRC_PREFIX}${encodeURIComponent(target)}${SRC_SUFFIX}`;
    expect(parseVirtualUrl(url)).toEqual({kind: 'src', target});
  }
});
