/**
 * Deck's application state, as ngin providers, actions and queries.
 *
 * The store itself is a single dodo cell holding one plain object. Queries
 * subscribe to it and notify the slice they care about; actions replace it.
 * Nothing here reaches for the DOM, so the whole file is testable against a
 * fake IndexedDB and a fake fetcher.
 */

import {Provider, Query, Action} from '@3sln/ngin';
import {cell, toObservable} from '@3sln/dodo/reactive';
import {marked} from 'marked';
import * as db from './db.js';
import {PRIORITY} from './fetcher.js';

// --- Data Transformation ---

export function transformCard(path, source) {
  // `.html` cards are already HTML. Running them through marked mangles
  // anything whose indentation happens to look like a code block.
  const html = path.endsWith('.html') ? source : marked(source);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const h1El = doc.querySelector('h1');
  const title = h1El?.textContent || path;
  const summary = doc.querySelector('p')?.textContent || '';

  h1El?.remove();
  const body = doc.body.innerHTML;

  return {path, title, summary, body};
}

// --- UI State Store ---

class UIState {
  #cell;
  #observable;

  constructor(initialState) {
    this.#cell = cell(initialState);
    this.#observable = toObservable(this.#cell);
  }

  get value() {
    return this.#cell.getValue();
  }

  /** Observer-style, because that is what an ngin query's `boot` speaks. */
  subscribe(observerOrNext) {
    return this.#observable.subscribe(observerOrNext);
  }

  update(updater, ...args) {
    this.#cell.setValue(updater(this.#cell.getValue(), ...args));
  }

  /** Whether `path` is a card in this deck at all, loaded or not. */
  knows(path) {
    return this.value.knownPaths.has(path);
  }
}

// --- Providers ---

export const uiStateProvider = () =>
  Provider.fromSingleton(
    new UIState({
      query: '',
      selectedCardPath: null,
      pinnedCardPaths: [],
      knownPaths: new Set(),
    }),
  );

// --- Helpers shared by the queries ---

/**
 * Wraps an async job so that overlapping calls collapse instead of racing.
 *
 * Every card that finishes loading asks the card list to recompute, and a cold
 * load finishes thousands of them. Without this, thousands of overlapping
 * IndexedDB reads run at once and whichever happens to finish last wins —
 * which is not necessarily the most recent one, so the list can settle on a
 * stale answer. Runs are serialised, and any number of requests arriving during
 * a run coalesce into exactly one more.
 */
function serialize(job) {
  let running = false;
  let queued = false;

  return async function run() {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      do {
        queued = false;
        await job();
      } while (queued);
    } finally {
      running = false;
    }
  };
}

/** Trailing-edge debounce, for the storm of events a bulk load produces. */
function debounce(fn, ms) {
  let timer = null;
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
}

const CARD_LIST_LIMIT = 100;
const RELOAD_DEBOUNCE_MS = 150;

/** A card the index knows about but whose body has not arrived yet. */
function stubCard(meta) {
  return {...meta, body: '', loading: true};
}

async function searchCards(query, searchIndex) {
  if (!searchIndex.available) {
    return await db.findCardsByQuery(query, CARD_LIST_LIMIT);
  }
  // The precompiled index covers the whole deck, so results are complete from
  // the first keystroke. Stored copies are preferred where they exist, purely
  // so the list shows what the reader has actually opened.
  const hits = searchIndex.search(query, CARD_LIST_LIMIT);
  const stored = await db.getCards(hits.map(hit => hit.path));
  return hits.map((hit, i) => stored[i] ?? stubCard(hit));
}

async function browseCards(pinnedPaths, searchIndex) {
  const pinnedStored = await db.getCards(pinnedPaths);
  const pinned = pinnedPaths
    .map(
      (path, i) => pinnedStored[i] ?? (searchIndex.card(path) && stubCard(searchIndex.card(path))),
    )
    .filter(Boolean);

  const pinnedSet = new Set(pinnedPaths);
  const recent = (await db.getRecentCards(CARD_LIST_LIMIT)).filter(
    card => !pinnedSet.has(card.path),
  );

  // On a cold load nothing has been stored yet, so without the index the deck
  // would look empty until the first cards land. The index knows every card, so
  // the list can be complete straight away and fill in as bodies arrive.
  const seen = new Set([...pinnedSet, ...recent.map(card => card.path)]);
  const rest = searchIndex.available
    ? searchIndex
        .paths()
        .filter(path => !seen.has(path))
        .slice(0, Math.max(0, CARD_LIST_LIMIT - recent.length))
        .map(path => stubCard(searchIndex.card(path)))
    : [];

  return {search: [], recents: [...recent, ...rest], pinned};
}

// --- Queries ---

export class SearchQuery extends Query {
  static deps = ['state'];
  #subscription;

  boot({state}, {notify}) {
    let emitted = false;
    let last;
    this.#subscription = state.subscribe(s => {
      if (emitted && s.query === last) return;
      emitted = true;
      last = s.query;
      notify(s.query);
    });
  }

  kill() {
    this.#subscription?.unsubscribe();
  }
}

export class FilteredCards extends Query {
  static deps = ['state', 'searchIndex'];
  #cleanup;

  boot({state, searchIndex}, {notify, engineFeed}) {
    const reload = serialize(async () => {
      const {query, pinnedCardPaths} = state.value;
      if (query) {
        notify({search: await searchCards(query, searchIndex), recents: [], pinned: []});
      } else {
        notify(await browseCards(pinnedCardPaths, searchIndex));
      }
    });

    // A card landing changes the list, but a bulk load lands thousands of them
    // and the list only has to be right once they stop.
    const onCardEvent = debounce(reload, RELOAD_DEBOUNCE_MS);
    engineFeed.addEventListener('card-loaded', onCardEvent);
    engineFeed.addEventListener('card-removed', onCardEvent);
    engineFeed.addEventListener('cards-pruned', onCardEvent);

    let emitted = false;
    let lastQuery;
    let lastPinned;
    const subscription = state.subscribe(s => {
      if (emitted && s.query === lastQuery && s.pinnedCardPaths === lastPinned) return;
      emitted = true;
      lastQuery = s.query;
      lastPinned = s.pinnedCardPaths;
      reload();
    });

    this.#cleanup = () => {
      subscription.unsubscribe();
      engineFeed.removeEventListener('card-loaded', onCardEvent);
      engineFeed.removeEventListener('card-removed', onCardEvent);
      engineFeed.removeEventListener('cards-pruned', onCardEvent);
    };
  }

  kill() {
    this.#cleanup?.();
  }
}

export class SelectedCard extends Query {
  static deps = ['state', 'searchIndex'];
  #cleanup;

  boot({state, searchIndex}, {notify, engineFeed}) {
    let currentPath = null;

    const emit = async () => {
      const path = currentPath;
      if (!path) {
        notify(null);
        return;
      }
      const card = await db.getCard(path);
      // A second selection while this read was in flight owns the view now.
      if (path !== currentPath) return;
      if (card) {
        notify(card);
        return;
      }
      // The body has not arrived yet. The index still knows the title, so the
      // card opens immediately and fills in when `card-loaded` fires — which is
      // the whole point of prioritising this fetch.
      const meta = searchIndex.card(path);
      notify(stubCard(meta ?? {path, title: path, summary: ''}));
    };

    // `emitted` rather than comparing against the initial `currentPath`: the
    // common case is starting with no selection, and "null is still null" is
    // not a reason to stay silent — a query that never notifies never resolves,
    // and the view sits on its placeholder forever.
    let emitted = false;
    const subscription = state.subscribe(s => {
      if (emitted && s.selectedCardPath === currentPath) return;
      emitted = true;
      currentPath = s.selectedCardPath;
      emit();
    });

    const onCardLoaded = event => {
      if (event.detail.card.path === currentPath) notify(event.detail.card);
    };
    engineFeed.addEventListener('card-loaded', onCardLoaded);

    this.#cleanup = () => {
      subscription.unsubscribe();
      engineFeed.removeEventListener('card-loaded', onCardLoaded);
    };
  }

  kill() {
    this.#cleanup?.();
  }
}

// --- Actions ---

/**
 * Records every card path in the deck.
 *
 * Selection consults this rather than the database: a deep link arrives before
 * any card has been fetched, and a selection that waited for the body would
 * find nothing and clear itself — taking the `?c=` out of the URL on the way.
 */
export class RegisterCards extends Action {
  static deps = ['state'];
  constructor(paths) {
    super();
    this.paths = paths;
  }
  execute({state}) {
    state.update(s => ({...s, knownPaths: new Set(this.paths)}));
  }
}

export class SetPinnedCards extends Action {
  static deps = ['state'];
  constructor(paths) {
    super();
    this.paths = paths;
  }
  execute({state}) {
    state.update(s => ({...s, pinnedCardPaths: this.paths}));
  }
}

async function loadOne({path, hash}, {fetcher, searchIndex, priority, engineFeed, knownHash}) {
  if (hash && knownHash === hash) return;

  try {
    const url = new URL(path, location.href);
    const response = await fetcher.fetch(url, {priority, key: path});
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const source = await response.text();
    const card = transformCard(path, source);
    // With a precompiled index in hand the local inverted index is never read,
    // and building it is the most expensive part of storing a card.
    const stored = await db.upsertCard({...card, hash}, {index: !searchIndex.available});
    engineFeed.dispatchEvent(new CustomEvent('card-loaded', {detail: {card: stored}}));
  } catch (err) {
    console.error(`Failed to load card ${path}:`, err);
  }
}

/**
 * Loads the whole deck.
 *
 * Priority, not order, is what decides when a card arrives: the selected card
 * first, then anything matching the query already on screen, then the rest. All
 * of them are queued at once and the fetcher sorts it out, so a later selection
 * or a later search can still overtake the backlog.
 */
export class LoadCards extends Action {
  static deps = ['state', 'fetcher', 'searchIndex'];
  constructor(cardsData) {
    super();
    this.cardsData = cardsData;
  }

  async execute({state, fetcher, searchIndex}, {engineFeed}) {
    const {selectedCardPath, query} = state.value;
    const searchHits = new Set(
      query && searchIndex.available ? searchIndex.search(query, 100).map(hit => hit.path) : [],
    );
    const knownHashes = await db.getStoredHashes();

    const priorityFor = path => {
      if (path === selectedCardPath) return PRIORITY.IMMEDIATE;
      if (searchHits.has(path)) return PRIORITY.SEARCH;
      return PRIORITY.NORMAL;
    };

    await Promise.all(
      this.cardsData.map(cardData =>
        loadOne(cardData, {
          fetcher,
          searchIndex,
          engineFeed,
          priority: priorityFor(cardData.path),
          knownHash: knownHashes.get(cardData.path),
        }),
      ),
    );
  }
}

/** A single card, re-fetched unconditionally. This is the HMR path. */
export class LoadCard extends Action {
  static deps = ['fetcher', 'searchIndex'];
  constructor(cardData) {
    super();
    this.cardData = cardData;
  }
  async execute({fetcher, searchIndex}, {engineFeed}) {
    await loadOne(this.cardData, {
      fetcher,
      searchIndex,
      engineFeed,
      priority: PRIORITY.IMMEDIATE,
    });
  }
}

export class RemoveCard extends Action {
  constructor(path) {
    super();
    this.path = path;
  }
  async execute(_, {engineFeed}) {
    await db.removeCard(this.path);
    engineFeed.dispatchEvent(new CustomEvent('card-removed', {detail: {path: this.path}}));
  }
}

export class PruneCards extends Action {
  constructor(livePaths) {
    super();
    this.livePaths = livePaths;
  }
  async execute(_, {engineFeed}) {
    const pruned = await db.pruneCards(this.livePaths);
    if (pruned.length > 0) {
      engineFeed.dispatchEvent(new CustomEvent('cards-pruned', {detail: {paths: pruned}}));
    }
  }
}

/**
 * `record: false` is how navigation driven *by* the history — a popstate — sets
 * the state without writing to the history again. Writing back would push a new
 * entry for every Back press, and the button would stop working.
 */
export class SetSearchQuery extends Action {
  static deps = ['state', 'history', 'fetcher', 'searchIndex'];
  constructor(query, {record = true} = {}) {
    super();
    this.query = query ?? '';
    this.record = record;
  }
  execute({state, history, fetcher, searchIndex}) {
    if (this.query === state.value.query) return;
    if (this.record) history.replaceState({q: this.query});
    state.update(s => ({...s, query: this.query}));

    // Cards matching what is on screen are the ones about to be clicked.
    if (this.query && searchIndex.available) {
      const hits = searchIndex.search(this.query, 100).map(hit => hit.path);
      fetcher.prioritizeAll(hits, PRIORITY.SEARCH);
    }
  }
}

export class SelectCard extends Action {
  static deps = ['state', 'history', 'fetcher'];
  constructor(cardPath, {record = true} = {}) {
    super();
    this.cardPath = cardPath || null;
    this.record = record;
  }

  execute({state, history, fetcher}) {
    const current = state.value.selectedCardPath;
    // A path this deck does not contain is treated as no selection, which is
    // what a stale bookmark to a deleted card should do.
    const path = this.cardPath && state.knows(this.cardPath) ? this.cardPath : null;

    if (path === current) return;
    if (this.record) history.pushState({c: path});
    state.update(s => ({...s, selectedCardPath: path}));

    if (path) {
      // Deliberately not awaited: the selection is already correct, and making
      // the view wait on a database round trip is what used to lose deep links.
      fetcher.prioritize(path, PRIORITY.IMMEDIATE);
      db.touchCard(path).catch(err => console.error('Failed to touch card:', err));
    }
  }
}

export class ClearSelection extends Action {
  static deps = ['state', 'history'];
  execute({state, history}) {
    if (state.value.selectedCardPath === null) return;
    history.pushState({c: null});
    state.update(s => ({...s, selectedCardPath: null}));
  }
}
