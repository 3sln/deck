import * as dodo from '@3sln/dodo';
import observableFactory from '@3sln/bones/observable.js';
import { Engine } from '@3sln/ngin';
import { 
    stateProvider, 
    FilteredCards, 
    SelectedCard, 
    IsWideScreen, 
    SetSearchQuery, 
    SelectCard, 
    ClearSelection 
} from './state.js';

// Initialize dodo and bones components
const { reconcile, h, div, h2, input, p, button, article, header, section, alias } = dodo;
const { watch, zip } = observableFactory({ dodo });

// --- UI Components ---

const searchBar = alias((engine) => {
    return div({ className: 'search-bar' }, 
        input({ 
            type: 'search', 
            placeholder: 'Search cards...',
            $styling: { width: '100%', padding: '0.5em', 'font-size': '1.2em', border: 'none', 'border-bottom': '1px solid #eee' }
        }).on({ 
            input: (e) => engine.dispatch(new SetSearchQuery(e.target.value)) 
        })
    );
});

const cardListItem = alias((card, engine) => {
    return div({
        className: 'card-list-item',
        $styling: { 
            padding: '1em', 
            'border-bottom': '1px solid #eee', 
            cursor: 'pointer' 
        }},
        h2({ $styling: { margin: '0 0 0.25em', fontSize: '1.1em' } }, card.title),
        p({ $styling: { margin: 0, color: '#666', fontSize: '0.9em' } }, card.summary)
    ).on({ click: () => engine.dispatch(new SelectCard(card.path)) });
});

const cardList = alias((cards, engine) => {
    return div({ className: 'card-list', $styling: { 'overflow-y': 'auto' } },
        cards.map(card => cardListItem(card, engine))
    );
});

const detailView = alias((card, engine) => {
    return article({ className: 'detail-view', $styling: { padding: '1em', 'overflow-y': 'auto', 'flex-grow': 1 } },
        header({ $styling: { display: 'flex', 'justify-content': 'flex-end' } },
            button({ $styling: { 'margin-bottom': '1em' } }, 'Close').on({ click: () => engine.dispatch(new ClearSelection()) })
        ),
        section({ innerHTML: card.html }).opaque()
    );
});

const app = alias((engine) => {
    const state$ = zip(
        (selectedCard, filteredCards, isWide) => ({ selectedCard, filteredCards, isWide }),
        engine.query(new SelectedCard()),
        engine.query(new FilteredCards()),
        engine.query(new IsWideScreen())
    );

    return watch(state$, ({ selectedCard, filteredCards, isWide }) => {
        const listView = div({ 
            className: 'list-view', 
            $styling: { 
                display: 'flex', 
                'flex-direction': 'column', 
                width: isWide ? '350px' : '100%', 
                'min-width': '350px', 
                'border-right': '1px solid #eee' 
            }
        },
            searchBar(engine),
            cardList(filteredCards, engine)
        );

        if (selectedCard) {
            if (isWide) {
                // Split-screen view
                return div({ $styling: { display: 'flex', height: '100vh', width: '100vw' } },
                    listView,
                    detailView(selectedCard, engine)
                );
            } else {
                // Detail-only view
                return detailView(selectedCard, engine);
            }
        } else {
            // List-only view
            return listView;
        }
    }, {
        placeholder: () => p('Loading Reel...')
    });
});

// --- Initial Render ---

export function renderReel({ target, initialCards }) {
  const engine = new Engine({
      providers: {
          state: stateProvider(initialCards)
      }
  });

  reconcile(target, [app(engine)]);
}
