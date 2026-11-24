import {afterAll, beforeAll, expect, test} from 'bun:test';
import {Window} from 'happy-dom';
import {createArtifacts, describeCard} from '../src/artifacts.js';
import {composeDecks, openDeck} from '../src/data.js';

const window = new Window({url: 'https://docs.example/'});
const {document} = window;
const originalGlobals = new Map();
let renderDeck;

beforeAll(async () => {
  const globals = {
    window,
    document,
    CSSStyleSheet: window.CSSStyleSheet,
    customElements: window.customElements,
    HTMLElement: window.HTMLElement,
    getComputedStyle: window.getComputedStyle.bind(window),
  };
  for (const [key, value] of Object.entries(globals)) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
  }
  ({renderDeck} = await import('../src/main.js'));
});

afterAll(async () => {
  await window.close();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

async function fixture(id, indexResponse, cardResponse = body => new Response(body)) {
  const body = `# ${id} card\n\nConfiguration guide`;
  const {manifest, index} = createArtifacts([await describeCard(`cards/${id}.md`, body)], {
    title: id,
  });
  return openDeck({
    id,
    manifestUrl: new URL(`/${id}/deck-manifest.json`, window.location.href),
    fetch(url) {
      if (url.pathname.endsWith('deck-manifest.json')) return Response.json(manifest);
      if (url.pathname.endsWith('deck-search-index.json')) return indexResponse(index);
      return cardResponse(body);
    },
  });
}

async function mount(collection) {
  const target = document.body.appendChild(document.createElement('div'));
  const instance = await renderDeck({target, collection, offlineStore: null});
  return {
    target,
    search: target.querySelector('.deck-search'),
    feedback: target.querySelector('.deck-search-feedback'),
    dispose() {
      instance.dispose();
      target.remove();
    },
  };
}

function type(search, text) {
  search.value = text;
  search.dispatchEvent(new window.Event('input'));
}

test('slow search reports progress, fails into browsing, and retries the same query', async () => {
  const first = Promise.withResolvers();
  let requests = 0;
  const deck = await fixture('Primary', index => {
    requests++;
    return requests === 1 ? first.promise : Response.json(index);
  });
  let emptyRequests = 0;
  const empty = {
    ...deck,
    id: 'Empty',
    title: 'Empty',
    cards: [],
    pinned: [],
    search() {
      emptyRequests++;
      return [];
    },
  };
  const {target, search, feedback, dispose} = await mount(composeDecks([deck, empty]));
  try {
    const status = feedback.querySelector('[role="status"]');
    const retry = feedback.querySelector('button');
    expect(requests).toBe(0);
    expect(search.disabled).toBe(false);
    type(search, 'configuration');
    expect(status.textContent).toBe('');
    await Bun.sleep(430);
    expect(status.textContent).toBe('Loading search…');
    const results = target.querySelector('.deck-results');
    expect(results.getAttribute('aria-busy')).toBe('true');
    expect(results.hasAttribute('data-search-loading')).toBe(true);

    first.resolve(new Response(null, {status: 503}));
    await Bun.sleep(0);
    expect(status.textContent).toContain('You can still browse cards');
    expect(search.disabled).toBe(true);
    expect(search.value).toBe('configuration');
    expect(retry.hidden).toBe(false);
    expect(results.hasAttribute('data-search-loading')).toBe(false);
    expect(target.querySelector('.deck-card').textContent).toContain('Primary card');

    retry.click();
    await Bun.sleep(0);
    expect(requests).toBe(2);
    expect(emptyRequests).toBe(0);
    expect(search.disabled).toBe(false);
    expect(retry.hidden).toBe(true);
    expect(status.textContent).toBe('');
    expect(target.querySelector('.deck-section-heading').textContent).toBe('Results');
  } finally {
    dispose();
  }
}, 15_000);

test('a failed manifest keeps search disabled until the deck is retried successfully', async () => {
  const card = await describeCard('cards/guide.md', '# Guide');
  const {manifest} = createArtifacts([card], {title: 'Project'});
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  let requests = 0;
  const target = document.body.appendChild(document.createElement('div'));
  let instance;
  try {
    const mounted = renderDeck({
      target,
      decks: [
        {
          manifestUrl: 'https://docs.example/deck-manifest.json',
          fetch: () => (++requests === 1 ? first.promise : second.promise),
        },
      ],
      offlineStore: null,
    });
    const search = target.querySelector('.deck-search');
    const feedback = target.querySelector('.deck-load-feedback');
    const status = feedback.querySelector('[role="status"]');
    const retry = feedback.querySelector('button');
    expect(search.disabled).toBe(true);
    expect(status.textContent).toBe('Loading deck…');

    first.resolve(new Response(null, {status: 503}));
    instance = await mounted;
    expect(status.textContent).toBe('Could not load the deck.');
    expect(search.disabled).toBe(true);
    expect(retry.hidden).toBe(false);

    retry.click();
    expect(retry.disabled).toBe(true);
    expect(status.textContent).toBe('Loading deck…');
    second.resolve(Response.json(manifest));
    await Bun.sleep(0);
    expect(search.disabled).toBe(false);
    expect(retry.hidden).toBe(true);
    expect(target.querySelector('.deck-card-title').textContent).toBe('Guide');
  } finally {
    instance?.dispose();
    target.remove();
  }
});

test('a card download can be retried in place after an error', async () => {
  const first = Promise.withResolvers();
  let requests = 0;
  const deck = await fixture(
    'Primary',
    index => Response.json(index),
    body => (++requests === 1 ? first.promise : new Response(body)),
  );
  const {target, dispose} = await mount(composeDecks([deck]));
  try {
    target.querySelector('.deck-card').click();
    const detail = target.querySelector('.deck-detail');
    const status = detail.querySelector('[role="status"]');
    const content = detail.querySelector('.deck-content');
    const retry = [...detail.querySelectorAll('button')].find(
      button => button.textContent === 'Retry card',
    );
    expect(status.textContent).toBe('Loading card…');
    expect(content.getAttribute('aria-busy')).toBe('true');
    expect(retry.hidden).toBe(true);

    first.resolve(new Response(null, {status: 503}));
    await Bun.sleep(0);
    expect(status.textContent).toBe('This card could not be loaded.');
    expect(content.hasAttribute('aria-busy')).toBe(false);
    expect(retry.hidden).toBe(false);

    retry.click();
    await Bun.sleep(0);
    expect(requests).toBe(2);
    expect(status.textContent).toBe('');
    expect(retry.hidden).toBe(true);
    expect(content.textContent).toContain('Configuration guide');
  } finally {
    dispose();
  }
});

test('a failed index in a composition preserves search in the other deck', async () => {
  const healthy = await fixture('Healthy', index => Response.json(index));
  const broken = await fixture('Unavailable', () => new Response(null, {status: 503}));
  const {target, search, feedback, dispose} = await mount(composeDecks([healthy, broken]));
  try {
    type(search, 'configuration');
    await Bun.sleep(0);
    expect(search.disabled).toBe(false);
    expect(feedback.querySelector('[role="status"]').textContent).toBe(
      'Search is unavailable for Unavailable.',
    );
    expect([...target.querySelectorAll('.deck-card-title')].map(card => card.textContent)).toEqual([
      'Healthy card',
    ]);
  } finally {
    dispose();
  }
});
