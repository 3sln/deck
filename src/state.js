import { Provider, Query, Action } from '@3sln/ngin';
import busFactory from '@3sln/bones/bus.js';
import observableFactory from '@3sln/bones/observable.js';
import * as dodo from '@3sln/dodo';

const { ObservableSubject } = busFactory({ dodo });
const { zip } = observableFactory({ dodo });

// --- Data Transformation ---

function transformCard(card) {
    const doc = new DOMParser().parseFromString(card.html, 'text/html');
    const title = doc.querySelector('h1')?.textContent || card.path;
    const summary = doc.querySelector('p')?.textContent || '';
    return { ...card, title, summary };
}

// --- App State Store ---

class AppState {
    #subject;

    constructor(initialState) {
        this.#subject = new ObservableSubject(initialState);
        this.#listenForHmr();
    }

    get state$() {
        return this.#subject;
    }

    update(updater, ...args) {
        const currentState = this.#subject.value;
        const newState = updater(currentState, ...args);
        this.#subject.next(newState);
    }

    #listenForHmr() {
        if (import.meta.hot) {
            import.meta.hot.on('reel:cards-update', (data) => {
                console.log('Card list changed via HMR, updating state...');
                const transformedCards = data.cards.map(transformCard);
                this.update(s => ({ ...s, allCards: transformedCards }));
            });
        }
    }
}

// --- Ngin Components ---

export const stateProvider = (initialCards) => {
    const transformedCards = initialCards.map(transformCard);
    const appState = new AppState({ 
        allCards: transformedCards,
        query: '',
        selectedCardPath: null,
    });
    return Provider.fromSingleton(appState);
};

// --- Queries ---

export class AllCards extends Query {
    static deps = ['state'];
    boot({ state }, { notify }) {
        state.state$.subscribe(s => notify(s.allCards));
    }
}

export class SearchQuery extends Query {
    static deps = ['state'];
    boot({ state }, { notify }) {
        state.state$.subscribe(s => notify(s.query));
    }
}

export class FilteredCards extends Query {
    static deps = ['state'];
    boot({ state }, { notify }) {
        let lastCards = null;
        let lastQuery = null;

        state.state$.subscribe(s => {
            if (s.allCards !== lastCards || s.query !== lastQuery) {
                lastCards = s.allCards;
                lastQuery = s.query;

                if (!lastQuery) {
                    notify(lastCards);
                    return;
                }
                const lowerQuery = lastQuery.toLowerCase();
                const filtered = lastCards.filter(card => 
                    card.path.toLowerCase().includes(lowerQuery) || 
                    card.title.toLowerCase().includes(lowerQuery) ||
                    card.summary.toLowerCase().includes(lowerQuery)
                );
                notify(filtered);
            }
        });
    }
}

export class SelectedCard extends Query {
    static deps = ['state'];
    boot({ state }, { notify }) {
        state.state$.subscribe(s => {
            const card = s.selectedCardPath 
                ? s.allCards.find(c => c.path === s.selectedCardPath) 
                : null;
            notify(card);
        });
    }
}

export class IsWideScreen extends Query {
    boot(_, { notify }) {
        const mql = window.matchMedia('(min-width: 768px)');
        const listener = (e) => notify(e.matches);
        mql.addEventListener('change', listener);
        notify(mql.matches);
        return () => mql.removeEventListener('change', listener);
    }
    kill(resources, { bootResult }) {
        bootResult?.();
    }
}

// --- Actions ---

export class SetSearchQuery extends Action {
    static deps = ['state'];
    constructor(query) {
        super();
        this.query = query;
    }
    execute({ state }) {
        state.update(s => ({ ...s, query: this.query }));
    }
}

export class SelectCard extends Action {
    static deps = ['state'];
    constructor(cardPath) {
        super();
        this.cardPath = cardPath;
    }
    execute({ state }) {
        state.update(s => ({ ...s, selectedCardPath: this.cardPath }));
    }
}

export class ClearSelection extends Action {
    static deps = ['state'];
    execute({ state }) {
        state.update(s => ({ ...s, selectedCardPath: null }));
    }
}