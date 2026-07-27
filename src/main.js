import * as dodo from '@3sln/dodo';
import {watch, derive, fromObservable} from '@3sln/dodo/reactive';
import {withElementSize} from '@3sln/dodo/observe';
import {css} from '@3sln/dodo/style';
import {Engine, Provider} from '@3sln/ngin';
import * as db from './db.js';
import {PriorityFetcher, PRIORITY} from './fetcher.js';
import {SearchIndex, INDEX_FILE} from './search-index.js';
import {highlight, stylesheet as highlightStylesheet} from './highlight.js';
import * as history from './history.js';
import {setDevMode} from './dev-mode.js';
import {connectHmr} from './dev-runtime.js';
import {
  uiStateProvider,
  FilteredCards,
  SelectedCard,
  SetSearchQuery,
  SelectCard,
  ClearSelection,
  LoadCard,
  LoadCards,
  RemoveCard,
  PruneCards,
  RegisterCards,
  SetPinnedCards,
  SearchQuery,
} from './state.js';
import './deck-demo.js';

const {reconcile, h, div, h1, h2, input, p, button, article, header, section, alias, span} = dodo;

/** Below this the list and the card cannot share the screen, so they take turns. */
const WIDE_BREAKPOINT = 768;

/**
 * Everything about deck's own layout lives here rather than in `$styling`
 * literals scattered through the components.
 *
 * The gutter in particular: the search bar, the card list and the card body all
 * have to line up, and they only do that if there is exactly one place that
 * says how far in from the edge things sit. Nesting one padded box inside
 * another is how the search field ended up flush against the window while the
 * cards below it were inset.
 */
const stylesheet = css`
  :root {
    --deck-gutter: 1rem;
    --deck-list-width: 700px;
  }

  .deck-root {
    display: flex;
    align-items: stretch;
    justify-content: center;
    min-height: 100vh;
    min-height: 100dvh;
    box-sizing: border-box;
  }

  .deck-root.split {
    height: 100vh;
    height: 100dvh;
    justify-content: flex-start;
    overflow: hidden;
  }

  .list-view {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    box-sizing: border-box;
    width: 100%;
    max-width: var(--deck-list-width);
    padding: var(--deck-gutter);
    gap: var(--deck-gutter);
  }

  .split .list-view {
    flex: 1 1 380px;
    max-width: 460px;
    border-right: 1px solid var(--border-color);
  }

  .search-bar input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 0.75em 1em;
    font-size: 1.05em;
    font-family: inherit;
    border: 1px solid var(--input-border);
    background-color: var(--input-bg);
    color: var(--text-color);
    border-radius: 2em;
    outline: none;
    transition: box-shadow 0.2s;
  }

  .search-bar input:focus {
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .card-list {
    display: flex;
    flex-direction: column;
    gap: var(--deck-gutter);
    overflow-y: auto;
    /* Keeps the last card's shadow and focus ring off the scroll edge. */
    padding-bottom: var(--deck-gutter);
    min-height: 0;
  }

  .card-list-heading {
    margin: 0.5em 0 0;
    color: var(--text-color);
    opacity: 0.6;
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .card-list-item {
    padding: 1em;
    border: 1px solid var(--border-color);
    background-color: var(--card-bg);
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .card-list-item:hover,
  .card-list-item:focus-visible {
    background-color: var(--card-hover-bg);
    outline: none;
  }

  .card-list-item:focus-visible {
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .card-list-item h2 {
    margin: 0 0 0.25em;
    font-size: 1.1em;
  }

  .card-list-item p {
    margin: 0;
    color: var(--muted-color);
    font-size: 0.9em;
  }

  .detail-pane {
    flex: 2 1 0%;
    display: flex;
    justify-content: center;
    min-width: 0;
    min-height: 0;
  }

  .detail-view {
    box-sizing: border-box;
    width: 100%;
    max-width: 1200px;
    /*
     * No padding at the top: position sticky measures from the scroll
     * container's padding edge, so a padded container leaves a band above the
     * stuck header where the body scrolls past in plain view. The header
     * carries that space itself instead.
     */
    padding: 0 var(--deck-gutter) var(--deck-gutter);
    overflow-wrap: break-word;
  }

  /*
   * Only the split layout gives the card its own scroll container. On one
   * column the page itself scrolls: an element with overflow-y auto is a
   * scroll container whether or not it overflows, and a sticky header inside
   * one sticks to *it*, not to the viewport, so the card's title would scroll
   * away on a phone.
   */
  .split .detail-view {
    height: 100%;
    overflow-y: auto;
  }

  .detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--deck-gutter);
    position: sticky;
    top: 0;
    z-index: 1;
    /* The body scrolls under this, so it needs something to scroll under. */
    background-color: var(--bg-color);
    padding: var(--deck-gutter) 0 0.5rem;
    margin: 0;
  }

  .detail-title {
    margin: 0;
    font-size: 1.6em;
    line-height: 1.25;
    min-width: 0;
  }

  .close-button {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    /* A 44px target: the close button is the only way back on a phone. */
    width: 44px;
    height: 44px;
    color: var(--text-color);
  }

  .close-button:hover,
  .close-button:focus-visible {
    background-color: var(--card-hover-bg);
    outline: none;
  }

  .detail-body img,
  .detail-body video,
  .detail-body iframe {
    max-width: 100%;
  }

  .detail-body table {
    display: block;
    overflow-x: auto;
    max-width: 100%;
  }

  .deck-status {
    padding: var(--deck-gutter);
    color: var(--muted-color);
  }

  @media (max-width: ${WIDE_BREAKPOINT}px) {
    :root {
      --deck-gutter: 0.75rem;
    }
  }
`;

// --- UI Components ---

const closeIcon = () =>
  h(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      height: '24px',
      viewBox: '0 0 24 24',
      width: '24px',
      fill: 'currentColor',
      'aria-hidden': 'true',
    },
    h('path', {d: 'M0 0h24v24H0z', fill: 'none'}),
    h('path', {
      d: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    }),
  );

const searchBar = alias(engine => {
  const query$ = fromObservable(engine.query(new SearchQuery()), {initial: ''});

  return watch(query$, query =>
    div(
      {className: 'search-bar'},
      input({
        type: 'search',
        placeholder: 'Search cards...',
        'aria-label': 'Search cards',
        value: query,
      }).on({
        input: e => engine.dispatch(new SetSearchQuery(e.target.value)),
      }),
    ),
  );
});

const cardListItem = alias((card, engine) =>
  div(
    {
      className: 'card-list-item',
      role: 'button',
      tabIndex: 0,
    },
    h2(card.title),
    p(card.summary),
  ).on({
    click: () => engine.dispatch(new SelectCard(card.path)),
    keydown: e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        engine.dispatch(new SelectCard(card.path));
      }
    },
  }),
);

const heading = title => h2({className: 'card-list-heading'}, title);

const cardList = alias(({search, recents, pinned} = {}, engine) => {
  const item = card => cardListItem(card, engine).key(card.path);

  return div(
    {className: 'card-list'},
    (search || []).length > 0 && search.map(item),
    (pinned || []).length > 0 && [heading('Pinned'), ...pinned.map(item)],
    (recents || []).length > 0 && [heading('Recents'), ...recents.map(item)],
  );
});

const detailView = alias((card, engine) => {
  const closeButton = button(
    {className: 'close-button', type: 'button', 'aria-label': 'Close card'},
    closeIcon(),
  ).on({click: () => engine.dispatch(new ClearSelection())});

  // A card with no `# Heading` has its title fall back to its path, and showing
  // a file path as a title is worse than showing none.
  const showTitle = card.title !== card.path;

  return article(
    {className: 'detail-view'},
    header(
      {className: 'detail-header'},
      showTitle ? h1({className: 'detail-title'}, card.title) : span(),
      closeButton,
    ),
    card.loading
      ? p({className: 'deck-status'}, 'Loading card…')
      : section({className: 'detail-body', innerHTML: card.body})
          .opaque()
          .on({$update: el => highlight(el)}),
  );
});

const listView = alias((filteredCards, engine) =>
  div({className: 'list-view'}, searchBar(engine), cardList(filteredCards || {}, engine)),
);

function layout({wide, selectedCard, filteredCards, engine}) {
  if (!selectedCard) {
    return div({className: 'deck-root'}, listView(filteredCards, engine));
  }
  if (!wide) {
    return div({className: 'deck-root'}, detailView(selectedCard, engine));
  }
  return div(
    {className: 'deck-root split'},
    listView(filteredCards, engine),
    div({className: 'detail-pane'}, detailView(selectedCard, engine)),
  );
}

const app = alias(engine => {
  const state$ = derive(
    [
      fromObservable(engine.query(new SelectedCard())),
      fromObservable(engine.query(new FilteredCards())),
    ],
    (selectedCard, filteredCards) => ({selectedCard, filteredCards}),
  );

  // `withElementSize` re-runs this builder whenever the container's box
  // changes, but the app only cares about which side of the breakpoint it
  // landed on. Memoising the inner builder per side means the vnode is
  // identical across a resize that did not cross it, and the reconciler stops
  // there rather than rebuilding the tree on every frame of a window drag.
  const builders = new Map();
  const builderFor = wide => {
    let builder = builders.get(wide);
    if (!builder) {
      builder = ({selectedCard, filteredCards}) =>
        layout({wide, selectedCard, filteredCards, engine});
      builders.set(wide, builder);
    }
    return builder;
  };

  const watchOptions = {placeholder: () => p({className: 'deck-status'}, 'Indexing cards…')};

  return withElementSize(({width}) =>
    watch(state$, builderFor(width > WIDE_BREAKPOINT), watchOptions),
  );
});

// --- Initial Render ---

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    // Resolved against the document, not the origin root: a deck published to a
    // project page lives under a path, and `/sw.js` is not it.
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(err => {
      console.warn('Deck: service worker registration failed; offline support is off.', err);
    });
  });
}

/**
 * Boots the app.
 *
 * The order here is the whole loading strategy:
 *
 *   1. the precompiled search index, before any card, so the very first search
 *      and the very first list are answered from the whole deck;
 *   2. the selection the URL asks for, so a deep link opens immediately;
 *   3. everything matching the query the URL asks for;
 *   4. the rest of the deck, in the background.
 *
 * Steps 2–4 are priorities on one queue rather than separate phases, so a
 * selection or a search made while the backlog is draining still overtakes it.
 */
export async function renderDeck({
  target,
  initialCardsData,
  pinnedCardPaths,
  searchIndexUrl,
  dev = false,
}) {
  // Before anything renders: a `<deck-demo>` in the first card is upgraded by
  // the parser and asks whether it is in dev the moment it connects.
  setDevMode(dev);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, stylesheet, highlightStylesheet];

  const fetcher = new PriorityFetcher();
  const searchIndex = new SearchIndex();

  // A dev server has no precompiled index — the deck is being edited, and an
  // index built a moment ago would already be describing the previous version.
  const indexUrl = dev ? null : (searchIndexUrl ?? INDEX_FILE);
  await Promise.all([
    indexUrl
      ? searchIndex.load(new URL(indexUrl, document.baseURI), {
          fetch: (url, options) =>
            fetcher.fetch(url, {...options, priority: PRIORITY.IMMEDIATE, key: 'deck:index'}),
        })
      : Promise.resolve(false),
    db.initDB(),
  ]);

  if (!dev) registerServiceWorker();

  const engine = new Engine({
    providers: {
      state: uiStateProvider(),
      fetcher: Provider.fromSingleton(fetcher),
      history: Provider.fromSingleton(history),
      searchIndex: Provider.fromSingleton(searchIndex),
    },
  });

  const cards = initialCardsData ?? [];

  // Selection has to be possible before any card body exists, so the deck's
  // contents are declared first and the URL is applied second.
  engine.dispatch(new RegisterCards(cards.map(card => card.path)));
  engine.dispatch(new SetPinnedCards(pinnedCardPaths || []));

  const syncNav = ({record}) => {
    const {q, c} = history.getQueryParams();
    engine.dispatch(new SelectCard(c, {record}));
    engine.dispatch(new SetSearchQuery(q, {record}));
  };

  // A popstate is the history telling us where it went; writing back to it
  // would push a new entry and the Back button would never leave the page.
  history.onPopState(() => syncNav({record: false}));
  syncNav({record: false});

  reconcile(target, [app(engine)]);

  engine.dispatch(new PruneCards(cards.map(card => card.path)));
  engine.dispatch(new LoadCards(cards));

  if (dev) {
    const hmr = await connectHmr({dev});
    hmr.on('deck:card-changed', ({path}) => engine.dispatch(new LoadCard({path})));
    hmr.on('deck:card-removed', ({path}) => engine.dispatch(new RemoveCard(path)));
  }

  return engine;
}
