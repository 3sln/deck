# Core Concepts

Deck's design is based on a few key architectural choices.

## Client-Side Indexing

Deck stores documentation content in a client-side database (IndexedDB). The initial `index.html` file contains a manifest of all card paths along with a hash of their content.

Upon loading, the application compares this manifest with the data already stored in its IndexedDB, and fetches only the cards that are new or have changed. Nothing blocks on the whole deck arriving: the shell renders immediately, and cards fill in behind it.

Assets that are not cards, such as the JavaScript files for `<deck-demo>` elements, are not pre-fetched. They are fetched and cached by the service worker only when a user views them for the first time.

## The Precompiled Search Index

A published deck ships a search index built at publish time. The browser downloads it **before any card**, which is what lets the very first search cover the whole deck rather than the fraction of it that has finished loading. Because the index carries each card's title and summary, results render immediately, whether or not their bodies have arrived.

A dev server has no precompiled index — the deck is being edited, and an index built a moment ago already describes the previous version. There, search is answered from the IndexedDB index of whatever has been loaded, which is the right trade when the content changes every few seconds.

## Loading Priority

Which card arrives first matters more than how many arrive per second. A published deck queues every card at once and lets priority decide the order:

1.  the precompiled search index, before any card;
2.  the card named by `?c=`, so a deep link opens immediately rather than after the rest of the deck has drained;
3.  cards matching the search currently on screen;
4.  everything else.

Steps 2–4 are priorities on one queue, not phases. A search typed while the backlog is still draining moves its matches to the front of that queue in place, so clicking a result opens it instead of showing a spinner.

## The `<deck-demo>` Element

The `<deck-demo>` custom element is used to embed live demos in Markdown files. Its `src` attribute points to a JavaScript file.

The script is executed within the element and is provided with a `driver` API. This API allows the demo to render content and manage its own state, keeping it isolated from the main Deck application and other demos.

In development the dev server serves two generated modules per demo: one that re-runs the demo when its file changes, and one that carries its source text for the Source panel. In a published deck the demo is bundled ahead of time, and the Source panel still shows the original file rather than the bundle.

## Dev Servers and the Build

Deck has two modes of operation:

1.  **Development:** `deck-dev` serves a deck with no bundler and no config. Plugins for Vite (`@3sln/deck/vite-plugin`), `@web/dev-server` (`@3sln/deck/wds-plugin`) and webpack-dev-server / Rspack (`@3sln/deck/webpack-plugin`) do the same job inside a dev server you already run — and the middleware behind them is plain connect, so any Node server can host a deck. Deck's own client app is pre-bundled either way, so the host runtime is never asked to resolve Deck's own dependencies.

2.  **Production (`deck-build`):** Creates a production-ready static site. It bundles the Deck application and every demo module with esbuild, copies the project's documentation files, precompiles the search index, writes `agents.md` and `agents.html`, and generates a static `index.html` for deployment.
