import {test, expect} from 'bun:test';
import {encodeIndex, SearchIndex, INDEX_VERSION} from '../src/search-index.js';
import {scoreCard, tokenize} from '../src/tokenize.js';

const card = (path, title, summary, body) => ({
  path,
  title,
  summary,
  hash: `hash-${path}`,
  scores: scoreCard({title, summary, body}),
});

const deck = [
  card(
    '/a.md',
    'Configuration',
    'How to configure a deck.',
    'Configuration lives in package.json.',
  ),
  card(
    '/b.md',
    'Getting Started',
    'Install and run.',
    'Install the package, then run the dev server.',
  ),
  card(
    '/c.md',
    'Concepts',
    'Design notes.',
    'The deck is indexed in the browser. Indexing is incremental.',
  ),
];

const loaded = () => {
  const index = new SearchIndex();
  index.install(encodeIndex(deck));
  return index;
};

test('an index round-trips through the wire format', () => {
  const encoded = encodeIndex(deck);
  expect(encoded.version).toBe(INDEX_VERSION);
  expect(encoded.cards).toHaveLength(3);
  // Postings are flat [cardIndex, score, ...] pairs, not arrays of pairs.
  expect(encoded.terms.configuration.length % 2).toBe(0);

  const index = loaded();
  expect(index.size).toBe(3);
  expect(index.card('/a.md')).toEqual({
    path: '/a.md',
    title: 'Configuration',
    summary: 'How to configure a deck.',
    hash: 'hash-/a.md',
  });
});

test('an unsearched index answers nothing rather than guessing', () => {
  const index = new SearchIndex();
  expect(index.available).toBe(false);
  expect(index.search('configuration')).toEqual([]);
  expect(index.card('/a.md')).toBeUndefined();
});

test('a title match outranks a body match', () => {
  const results = loaded().search('configuration');
  expect(results[0].path).toBe('/a.md');
});

test('the word being typed matches by prefix', () => {
  const index = loaded();
  // "conf" is not a word in any card; it is the start of one.
  expect(index.search('conf').map(r => r.path)).toEqual(['/a.md']);
  expect(index.search('index').map(r => r.path)).toEqual(['/c.md']);
});

test('an exact match beats the prefix matches it also has', () => {
  const index = loaded();
  const results = index.search('install');
  expect(results[0].path).toBe('/b.md');
});

test('earlier tokens must match a word, the last one need not', () => {
  const index = loaded();
  // "deck configu" — a finished word plus one still being typed.
  expect(index.search('deck configu').map(r => r.path)).toContain('/a.md');
  // A finished word that matches nothing still falls back to prefixes rather
  // than dropping the whole query on the floor.
  expect(index.search('configu deck').map(r => r.path)).toContain('/a.md');
});

test('a query with no word characters returns nothing', () => {
  expect(loaded().search('   ...   ')).toEqual([]);
  expect(loaded().search('')).toEqual([]);
});

test('results are capped at the limit', () => {
  expect(loaded().search('deck', 1)).toHaveLength(1);
});

test('paths come back in build order', () => {
  expect(loaded().paths()).toEqual(['/a.md', '/b.md', '/c.md']);
});

test('a load failure degrades instead of throwing', async () => {
  const index = new SearchIndex();
  const ok = await index.load('/nope.json', {
    fetch: async () => ({ok: false, status: 404, statusText: 'Not Found'}),
  });
  expect(ok).toBe(false);
  expect(index.available).toBe(false);
});

test('a load succeeds through an injected fetch', async () => {
  const index = new SearchIndex();
  const ok = await index.load('/index.json', {
    fetch: async () => ({ok: true, json: async () => encodeIndex(deck)}),
  });
  expect(ok).toBe(true);
  expect(index.available).toBe(true);
  expect(index.search('concepts')[0].path).toBe('/c.md');
});

test('an index from a future version is refused', () => {
  const index = new SearchIndex();
  expect(() => index.install({version: 99, cards: [], terms: {}})).toThrow();
});

test('tokenizing keeps letters, digits and underscores and drops the rest', () => {
  expect(tokenize('Hello, World! deck-build v2_0')).toEqual([
    'hello',
    'world',
    'deck',
    'build',
    'v2_0',
  ]);
  expect(tokenize('Ünïcödé wörds')).toEqual(['ünïcödé', 'wörds']);
  expect(tokenize(null)).toEqual([]);
});

test('a title match outweighs a summary match outweighs a few body mentions', () => {
  const scores = scoreCard({title: 'alpha', summary: 'beta', body: 'gamma gamma'});
  expect(scores.get('alpha')).toBeGreaterThan(scores.get('beta'));
  expect(scores.get('beta')).toBeGreaterThan(scores.get('gamma'));
  // A word only in the title still scores, even with an empty body.
  expect(scoreCard({title: 'solo'}).get('solo')).toBeGreaterThan(0);
});
