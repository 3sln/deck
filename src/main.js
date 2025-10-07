import * as dodo from '@3sln/dodo';
import observableFactory from '@3sln/bones/observable';
import resizeFactory from '@3sln/bones/resize';
import { Engine } from '@3sln/ngin';
import * as db from './db.js';
import { 
    uiStateProvider, 
    FilteredCards, 
    SelectedCard, 
    SetSearchQuery, 
    SelectCard, 
    ClearSelection,
    LoadCard,
    RemoveCard,
    PruneCards
} from './state.js';
import './reel-demo.js';

// Initialize dodo and bones components
const { reconcile, h, div, h1, h2, input, p, button, article, header, section, alias, span } = dodo;
const { watch, zip, map, dedup, pipe } = observableFactory({ dodo });
const { withContainerSize } = resizeFactory({ dodo });

// --- UI Components ---

const closeIcon = () => h('svg', {
    xmlns: 'http://www.w3.org/2000/svg', 
    height: '24px', 
    viewBox: '0 0 24 24', 
    width: '24px', 
    fill: 'var(--text-color)' 
}, 
    h('path', { d: 'M0 0h24v24H0z', fill: 'none' }),
    h('path', { d: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z' })
);

const searchBar = alias((engine) => {
    return div({ className: 'search-bar' }, 
        input({ 
            type: 'search', 
            placeholder: 'Search cards...',
            $styling: { 
                width: '100%', 
                padding: '0.75em 1em', 
                'font-size': '1.1em', 
                border: '1px solid var(--input-border)', 
                'background-color': 'var(--input-bg)',
                color: 'var(--text-color)',
                'border-radius': '2em',
                outline: 'none',
                transition: 'box-shadow 0.2s'
            }
        }).on({ 
            focus: (e) => e.target.style.boxShadow = '0 0 5px rgba(81, 203, 238, 1)',
            blur: (e) => e.target.style.boxShadow = 'none',
            input: (e) => engine.dispatch(new SetSearchQuery(e.target.value)) 
        })
    );
});

const cardListItem = alias((card, engine) => {
    return div(
      {
        className: 'card-list-item',
        $styling: { 
            padding: '1em', 
            border: '1px solid var(--border-color)',
            'background-color': 'var(--card-bg)',
            'border-radius': '8px',
            cursor: 'pointer',
            transition: 'background-color 0.2s'
        }
      },
      h2({ $styling: { margin: '0 0 0.25em', 'font-size': '1.1em' } }, card.title),
      p({ $styling: { margin: 0, color: '#666', 'font-size': '0.9em' } }, card.summary)
    ).on({
        click: () => engine.dispatch(new SelectCard(card.path)),
        mouseover: (e) => e.currentTarget.style.backgroundColor = 'var(--card-hover-bg)',
        mouseout: (e) => e.currentTarget.style.backgroundColor = 'var(--card-bg)'
    });
});

const cardList = alias((cards, engine) => {
    return div({ 
        className: 'card-list', 
        $styling: { 
            'overflow-y': 'auto',
            display: 'flex',
            'flex-direction': 'column',
            gap: '1em',
            padding: '1em'
        }
    },
        cards.map(card => cardListItem(card, engine))
    );
});

const detailView = alias((card, engine) => {
    const closeButton = button({
        $styling: {
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0.5em'
        }
    }, closeIcon()).on({ click: () => engine.dispatch(new ClearSelection()) });

    if (card.title !== card.path) {
        return article({
            className: 'detail-view',
            $styling: {
              padding: '0 1em 1em 1em',
              'overflow-y': 'auto',
              width: '100%',
              'max-width': '1200px',
              'box-sizing': 'border-box'
            }
        },
            h1({
                $styling: {
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'space-between'
                }
            },
                span({ $styling: { 'flex-grow': 1 } }, card.title),
                closeButton
            ),
            section({ innerHTML: card.body }).opaque()
        );
    } else {
        return article({
            className: 'detail-view',
            $styling: {
                padding: '1em',
                'overflow-y': 'auto',
                position: 'relative',
                width: '100%',
                'max-width': '1200px'
            }
        },
            header({
                $styling: {
                    display: 'flex',
                    'justify-content': 'flex-end',
                    position: 'sticky',
                    top: 0
                }
            },
                closeButton
            ),
            section({ innerHTML: card.body }).opaque()
        );
    }
});

const app = alias((engine) => {
    const state$ = zip(
        (selectedCard, filteredCards) => ({ selectedCard, filteredCards }),
        engine.query(new SelectedCard()),
        engine.query(new FilteredCards())
    );

    return withContainerSize(size$ => {
        const isWide$ = pipe(
            size$,
            map(size => size && size.width > 768),
            dedup()
        );

        return watch(isWide$, isWide => 
            watch(state$, ({ selectedCard, filteredCards }) => {
                const hasSelection = selectedCard != null;

                const listView = div({ 
                    className: 'list-view', 
                    $styling: { 
                        display: 'flex', 
                        'flex-direction': 'column',
                        flex: hasSelection && isWide ? '1 1 350px' : '0 0 clamp(400px, 60%, 700px)',
                        'max-width': hasSelection && isWide ? '500px' : '700px',
                        transition: 'flex 0.3s ease-in-out',
                        'padding-top': '1rem'
                    }
                },
                    searchBar(engine),
                    cardList(filteredCards || [], engine)
                );

                if (hasSelection) {
                    if (isWide) {
                        return div({ $styling: { display: 'flex', height: '100vh', width: '100vw', 'align-items': 'stretch' } },
                            listView,
                            div({ $styling: { flex: '2 1 50%', display: 'flex', 'justify-content': 'center', 'overflow-x': 'auto' } },
                              detailView(selectedCard, engine)
                            )
                        );
                    } else {
                        return detailView(selectedCard, engine);
                    }
                } else {
                    return div({ $styling: { display: 'flex', 'justify-content': 'center', padding: '2em 0' } },
                        listView
                    );
                }
            }, {
                placeholder: () => p('Indexing cards...')
            })
        );
    });
});

// --- Initial Render ---

export async function renderReel({ target, initialCardPaths }) {
  await db.initDB();

  const engine = new Engine({
      providers: {
          state: uiStateProvider()
      }
  });

  // Initial load
  initialCardPaths.forEach(path => {
      engine.dispatch(new LoadCard(path));
  });
  engine.dispatch(new PruneCards(initialCardPaths));

  // Handle HMR
  if (import.meta.hot) {
      import.meta.hot.on('reel:card-changed', ({ path }) => {
          engine.dispatch(new LoadCard(path));
      });
      import.meta.hot.on('reel:card-removed', ({ path }) => {
          engine.dispatch(new RemoveCard(path));
      });
  }

  reconcile(target, [app(engine)]);
}
