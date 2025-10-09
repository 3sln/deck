import {Provider, Query, Action} from '@3sln/ngin';
import busFactory from '@3sln/bones/bus';
import * as dodo from '@3sln/dodo';
import {marked} from 'marked';
import * as db from './db.js';

const {ObservableSubject} = busFactory({dodo});

// --- Data Transformation ---

function transformCard(path, markdown) {
  const html = marked(markdown);
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
  #subject;

  constructor(initialState) {
    this.#subject = new ObservableSubject(initialState);
  }

  get state$() {
    return this.#subject;
  }

  update(updater, ...args) {
    const currentState = this.#subject.value;
    const newState = updater(currentState, ...args);
    this.#subject.next(newState);
  }
}

// --- Ngin Components ---

export const uiStateProvider = () => {
  const uiState = new UIState({
    query: '',
    selectedCardPath: null,
  });
  return Provider.fromSingleton(uiState);
};

// --- Queries ---

export class SearchQuery extends Query {
  static deps = ['state'];
  boot({state}, {notify}) {
    state.state$.subscribe(s => notify(s.query));
  }
}

export class FilteredCards extends Query {
  static deps = ['state'];
  boot({state}, {notify, engineFeed}) {
    let currentQuery = null;

    const reQuery = async () => {
      const cards = currentQuery
        ? await db.findCardsByQuery(currentQuery)
        : await db.getRecentCards(100);
      notify(cards);
    };

    engineFeed.addEventListener('card-loaded', reQuery);
    engineFeed.addEventListener('card-removed', reQuery);
    engineFeed.addEventListener('cards-pruned', reQuery);

    state.state$.subscribe(s => {
      if (s.query !== currentQuery) {
        currentQuery = s.query;
        reQuery();
      }
    });

    reQuery(); // Initial query
  }
}

export class SelectedCard extends Query {
  static deps = ['state'];
  boot({state}, {notify, engineFeed}) {
    let currentPath = null;

    // React to selection changes from UI
    state.state$.subscribe(async s => {
      currentPath = s.selectedCardPath;
      if (!currentPath) {
        notify(null);
        return;
      }
      const card = await db.getCard(currentPath);
      notify(card);
    });

    // React to HMR updates for the currently selected card
    engineFeed.addEventListener('card-loaded', event => {
      if (event.detail.card.path === currentPath) {
        notify(event.detail.card);
      }
    });
  }
}

// --- Actions ---

export class LoadCard extends Action {
  constructor(path) {
    super();
    this.path = path;
  }
  async execute(_, {engineFeed}) {
    const fetchTime = Date.now();
    try {
      const url = new URL(this.path, location.href);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${this.path}: ${res.statusText}`);
      const markdown = await res.text();
      const card = transformCard(this.path, markdown);
      const newCard = await db.upsertCard(card, fetchTime);
      if (newCard) {
        engineFeed.dispatchEvent(new CustomEvent('card-loaded', {detail: {card: newCard}}));
      }
    } catch (err) {
      console.error(`Failed to load card ${this.path}:`, err);
    }
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

export class SetSearchQuery extends Action {
  static deps = ['state'];
  constructor(query) {
    super();
    this.query = query;
  }
  execute({state}) {
    state.update(s => ({...s, query: this.query}));
  }
}

export class SelectCard extends Action {
  static deps = ['state'];
  constructor(cardPath) {
    super();
    this.cardPath = cardPath;
  }
  async execute({state}) {
    await db.touchCard(this.cardPath);
    state.update(s => ({...s, selectedCardPath: this.cardPath}));
  }
}

export class ClearSelection extends Action {
  static deps = ['state'];
  execute({state}) {
    state.update(s => ({...s, selectedCardPath: null}));
  }
}

export class PruneCards extends Action {
  constructor(livePaths) {
    super();
    this.livePaths = livePaths;
  }
  async execute(_, {engineFeed}) {
    await db.pruneCards(this.livePaths);
    engineFeed.dispatchEvent(new CustomEvent('cards-pruned'));
  }
}
