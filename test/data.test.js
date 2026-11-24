import {expect, test} from 'bun:test';
import {createArtifacts, describeCard} from '../src/artifacts.js';
import {composeDecks, openDeck} from '../src/data.js';

const host = 'https://docs.example';

async function fixture(name, body, {offlineStore, versioning} = {}) {
  const url = new URL(`${host}/${name}/deck-manifest.json`);
  const path = '/cards/shared name.md';
  const {manifest, index} = createArtifacts([await describeCard(path.slice(1), body)], {
    title: name,
    pinned: [path],
    ...versioning,
  });
  const requests = [];
  let online = true;
  const options = {
    manifestUrl: url,
    id: name,
    offlineStore,
    fetch: async url => {
      requests.push(url.pathname);
      if (!online) throw new Error('Offline');
      if (url.pathname.endsWith('/deck-manifest.json')) return Response.json(manifest);
      if (url.pathname.endsWith('/deck-search-index.json')) return Response.json(index);
      if (decodeURIComponent(url.pathname).endsWith(path)) return new Response(body);
      return new Response(null, {status: 404});
    },
  };
  return {
    manifest,
    options,
    requests,
    path,
    setOnline: value => {
      online = value;
    },
  };
}

function fetchFromFixtures(...fixtures) {
  return url => {
    const source = fixtures.find(({options}) =>
      url.href.startsWith(new URL('.', options.manifestUrl).href),
    );
    return source?.options.fetch(url) ?? new Response(null, {status: 404});
  };
}

function memoryOfflineStore() {
  const metadata = new Map();
  const bodies = new Map();
  const key = (source, path) => JSON.stringify([source, path]);
  return {
    bodies,
    store: {
      readMetadata: async key => metadata.get(key),
      writeMetadata: async (key, value) => metadata.set(key, value),
      readCard: async (source, path, hash) => {
        const record = bodies.get(key(source, path));
        return hash === undefined || record?.hash === hash ? record : undefined;
      },
      writeCard: async (source, record) => bodies.set(key(source, record.path), record),
    },
  };
}

test('a newer selection wins and direct version changes notify the composition', async () => {
  const stable = await fixture('stable', '# Stable');
  const alternate = await fixture('alternate', '# Alternate');
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const deck = await openDeck({
    ...stable.options,
    version: 'stable',
    versions: [{id: 'alternate', manifestUrl: alternate.options.manifestUrl}],
    fetch: async url => {
      if (url.href === alternate.options.manifestUrl.href) await gate;
      return fetchFromFixtures(stable, alternate)(url);
    },
  });
  const collection = composeDecks([deck]);
  const seen = [];
  const unsubscribe = collection.subscribe(() => seen.push(deck.version));
  const pending = collection.setVersion(deck.id, 'alternate');
  await collection.setVersion(deck.id, 'stable');
  release();
  expect(await pending).toBe(false);
  expect(seen).toEqual([]);
  await deck.setVersion('alternate');
  expect(seen).toEqual(['alternate']);
  unsubscribe();
  await deck.setVersion('stable');
  expect(seen).toEqual(['alternate']);
});

test('composed projects keep colliding paths distinct and fetch bodies only on open', async () => {
  const a = await fixture('alpha', '---\ntags: [guide]\n---\n# Alpha\n\nBody has alliteration.');
  const b = await fixture('beta', '---\ntags: [reference]\n---\n# Beta\n\nBody has alliteration.');
  const collection = composeDecks(await Promise.all([a, b].map(({options}) => openDeck(options))));
  expect(collection.listCards().map(card => card.title)).toEqual(['Alpha', 'Beta']);
  expect(a.requests).toEqual(['/alpha/deck-manifest.json']);
  expect(b.requests).toEqual(['/beta/deck-manifest.json']);

  const results = await collection.search({query: 'allitera', tags: ['GUIDE']});
  expect(results.map(card => [card.deckId, card.path])).toEqual([['alpha', a.path]]);
  expect(a.requests).toEqual(['/alpha/deck-manifest.json', '/alpha/deck-search-index.json']);
  expect(b.requests).toEqual(['/beta/deck-manifest.json', '/beta/deck-search-index.json']);
  expect((await collection.getCard(results[0])).content).toContain('alliteration');
  expect(a.requests.at(-1)).toBe('/alpha/cards/shared%20name.md');

  collection.setEnabled('alpha', false);
  expect(collection.listPinned().map(card => card.deckId)).toEqual(['beta']);
  expect(await collection.search({query: 'allitera', tags: ['guide']})).toEqual([]);
});

test('reading a card does not retain its body, and explicit downloads survive reopening offline', async () => {
  const {store: offlineStore, bodies} = memoryOfflineStore();
  const deck = await fixture('alpha', '# Alpha\n\nBody has alliteration.', {offlineStore});
  const online = await openDeck(deck.options);
  await online.getCard(deck.path);
  expect(bodies.size).toBe(0);
  await online.saveCard(deck.path);
  deck.setOnline(false);
  const offline = await openDeck(deck.options);
  expect((await offline.search({query: 'allitera'}))[0].card.path).toBe(deck.path);
  expect((await offline.getCard(deck.path)).content).toContain('alliteration');
});

test('an authored slug identifies the card without changing its raw document path', async () => {
  const source = await fixture('slugged', '---\nslug: reference/client\n---\n# Client');
  expect(source.manifest.cards[0]).toMatchObject({
    path: source.path,
    slug: 'reference/client',
  });
  const deck = await openDeck(source.options);
  expect(deck.cards[0].slug).toBe('reference/client');
  expect((await deck.getCard(source.path)).content).toContain('# Client');
  expect(source.requests.at(-1)).toBe('/slugged/cards/shared%20name.md');
});

test('generated slugs normalize path segments and yield to authored slugs', async () => {
  const cards = await Promise.all([
    describeCard('cards/Install CLI.md', '# Markdown card'),
    describeCard('cards/install_cli.html', '<h1>HTML card</h1>'),
    describeCard('cards/setup.md', '---\nslug: install-cli\n---\n# Setup'),
    describeCard('cards/User guides/HTTP Client.md', '# HTTP Client'),
  ]);
  const {manifest} = createArtifacts(cards, {title: 'Cards'});
  const slugs = new Map(manifest.cards.map(card => [card.path, card.slug]));
  expect(slugs.get('/cards/setup.md')).toBe('install-cli');
  expect(slugs.get('/cards/User guides/HTTP Client.md')).toBe('user-guides/http-client');
  expect([slugs.get('/cards/Install CLI.md'), slugs.get('/cards/install_cli.html')].sort()).toEqual(
    ['install-cli-2', 'install-cli-3'],
  );
});

test('generated collisions leave natural numeric suffixes with their original cards', async () => {
  const cards = await Promise.all([
    describeCard('cards/Report.md', '# Original report'),
    describeCard('cards/report.html', '<h1>Another report</h1>'),
    describeCard('cards/report-2.md', '# Natural suffix'),
  ]);
  const {manifest} = createArtifacts(cards, {title: 'Reports'});
  const slugs = new Map(manifest.cards.map(card => [card.path, card.slug]));
  expect(slugs.get('/cards/report-2.md')).toBe('report-2');
  expect([slugs.get('/cards/Report.md'), slugs.get('/cards/report.html')].sort()).toEqual([
    'report',
    'report-3',
  ]);
});

test('two cards cannot claim the same authored slug in one deck', async () => {
  const cards = await Promise.all([
    describeCard('cards/one.md', '---\nslug: install-cli\n---\n# One'),
    describeCard('cards/two.md', '---\nslug: install-cli\n---\n# Two'),
  ]);
  expect(() => createArtifacts(cards, {title: 'Duplicate slugs'})).toThrow(
    /(?=.*slug)(?=.*\/cards\/one\.md)(?=.*\/cards\/two\.md)/is,
  );
});

test('plain artifact manifests omit documentation version fields', async () => {
  const {manifest} = await fixture('plain', '# Plain');
  for (const key of ['versionId', 'versions', 'defaultVersion']) {
    expect(Object.hasOwn(manifest, key)).toBe(false);
  }
});

test('a manifest catalog opens the current version and switches one project lazily', async () => {
  const preview = await fixture('preview', '# Preview docs\n\nUse the jasmine command.');
  const current = await fixture('stable', '# Stable docs\n\nUse the magnolia command.', {
    versioning: {
      version: 'stable',
      versions: [{id: 'preview', title: 'Preview', manifestUrl: '../preview/deck-manifest.json'}],
    },
  });
  const deck = await openDeck({...current.options, fetch: fetchFromFixtures(current, preview)});
  const collection = composeDecks([deck]);
  expect(deck.version).toBe('stable');
  expect(deck.versions.map(version => version.id).sort()).toEqual(['preview', 'stable']);
  expect(deck.versions.find(version => version.id === 'preview').title).toBe('Preview');
  expect(current.requests).toEqual(['/stable/deck-manifest.json']);
  expect(preview.requests).toEqual([]);

  const [stableCard] = await collection.search({query: 'magnolia'});
  expect(stableCard.title).toBe('Stable docs');
  const changes = [];
  collection.subscribe(() => changes.push(collection.decks[0].version));
  collection.setEnabled(deck.id, false);
  await collection.setVersion(deck.id, 'preview');
  expect(collection.isEnabled(deck.id)).toBe(false);
  expect(collection.listCards()).toEqual([]);
  expect(changes).toEqual(['stable', 'preview']);
  expect(preview.requests).toEqual(['/preview/deck-manifest.json']);

  collection.setEnabled(deck.id, true);
  expect(await collection.search({query: 'magnolia'})).toEqual([]);
  const [previewCard] = await collection.search({query: 'jasmine'});
  expect(previewCard.path).toBe(stableCard.path);
  expect(previewCard.deckId).toBe(stableCard.deckId);
  await expect(Promise.resolve().then(() => collection.getCard(stableCard))).rejects.toThrow();
  expect(preview.requests).toEqual([
    '/preview/deck-manifest.json',
    '/preview/deck-search-index.json',
  ]);
  expect((await collection.getCard(previewCard)).content).toContain('jasmine');
  expect(preview.requests.at(-1)).toBe('/preview/cards/shared%20name.md');
});

test('a published manifest can select a different documented default version', async () => {
  const paths = [{id: 'old', manifestUrl: '../old/deck-manifest.json'}];
  const previous = await fixture('old', '# Previous release');
  const current = await fixture('current', '# Current release', {
    versioning: {version: 'current', versions: paths, defaultVersion: 'old'},
  });
  expect(current.manifest).toMatchObject({
    version: 1,
    versionId: 'current',
    versions: paths,
    defaultVersion: 'old',
  });
  const deck = await openDeck({...current.options, fetch: fetchFromFixtures(current, previous)});
  expect(deck.version).toBe('old');
  expect(deck.cards[0].title).toBe('Previous release');
  expect(current.requests).toEqual(['/current/deck-manifest.json']);
  expect(previous.requests).toEqual(['/old/deck-manifest.json']);
});

test('explicit version descriptors select the requested default or the first entry', async () => {
  const first = await fixture('one', '# Release one');
  const second = await fixture('two', '# Release two');
  const versions = [
    {id: '1', manifestUrl: first.options.manifestUrl.href},
    {id: '2', manifestUrl: second.options.manifestUrl.href},
  ];
  const options = {id: 'releases', versions, fetch: fetchFromFixtures(first, second)};

  const firstDeck = await openDeck(options);
  expect(firstDeck.version).toBe('1');
  expect(firstDeck.cards[0].title).toBe('Release one');
  expect(first.requests).toEqual(['/one/deck-manifest.json']);
  expect(second.requests).toEqual([]);

  const secondDeck = await openDeck({...options, defaultVersion: '2'});
  expect(secondDeck.version).toBe('2');
  expect(secondDeck.cards[0].title).toBe('Release two');
  expect(first.requests).toEqual(['/one/deck-manifest.json']);
  expect(second.requests).toEqual(['/two/deck-manifest.json']);
});

test('descriptor version metadata overrides the manifest and a failed switch keeps the active version', async () => {
  const current = await fixture('release', '# Release docs', {
    versioning: {version: 'manifest-id', versions: []},
  });
  const published = await openDeck({
    ...current.options,
    fetch: fetchFromFixtures(current),
    version: 'current',
    versions: [{id: 'missing', manifestUrl: `${host}/missing/deck-manifest.json`}],
    defaultVersion: 'current',
  });
  expect(published.version).toBe('current');
  expect(published.versions.map(version => version.id).sort()).toEqual(['current', 'missing']);
  const collection = composeDecks([published]);
  const updates = [];
  collection.subscribe(() => updates.push(collection.decks[0].version));

  await expect(collection.setVersion(published.id, 'missing')).rejects.toThrow();
  expect(collection.decks[0].version).toBe('current');
  expect(collection.listCards()[0].title).toBe('Release docs');
  expect(updates).toEqual([]);
});

test('offline downloads for a card path stay scoped to its version manifest', async () => {
  const {store: offlineStore} = memoryOfflineStore();
  const older = await fixture('older', '# Original\n\nUse the quartz command.', {offlineStore});
  const newer = await fixture('newer', '# New\n\nUse the amber command.', {offlineStore});
  const options = {
    id: 'release',
    versions: [older, newer].map(({options}) => ({
      id: options.id,
      manifestUrl: options.manifestUrl.href,
    })),
    fetch: fetchFromFixtures(older, newer),
    offlineStore,
  };
  const online = composeDecks([await openDeck(options)]);
  await online.decks[0].saveCard(older.path);
  await online.setVersion('release', 'newer');
  expect((await online.search({query: 'amber'}))[0].path).toBe(older.path);
  older.setOnline(false);
  newer.setOnline(false);

  const offline = composeDecks([await openDeck(options)]);
  expect((await offline.getCard(offline.listCards()[0])).content).toContain('quartz');
  await offline.setVersion('release', 'newer');
  expect((await offline.search({query: 'amber'}))[0].path).toBe(older.path);
  await expect(
    Promise.resolve().then(() => offline.getCard(offline.listCards()[0])),
  ).rejects.toThrow('Offline');
});
