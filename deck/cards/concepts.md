---
tags: [search, offline]
---

# Core Concepts

Deck's design is based on a few key architectural choices.

## Deck Data and Search

The build and dev server produce a `deck-manifest.json` with card metadata and a reference to a prebuilt `deck-search-index.json`. Clients can list cards from the manifest. Text search loads the index, and opening a card loads its Markdown or HTML body on demand.

The same files power the stock UI, custom clients using `@3sln/deck/data`, and the optional documentation MCP server. In the stock UI, readers can toggle projects independently to control which cards are listed and searched. When a project advertises multiple versions, the reader can choose one for that project.

## Offline Reading

Use the stock UI's offline controls to save a card or a project. Saving a project downloads a snapshot of its cards. Removing that snapshot leaves any separately saved cards available. Search metadata and the generated application shell are cached separately so saved documentation can be found and opened offline. Images, demo modules, and other linked assets can still require a connection.

## The `<deck-demo>` Element

The `<deck-demo>` custom element is used to embed live demos in Markdown files. Its `src` attribute points to a JavaScript file.

The script is executed within the element and is provided with a `driver` API. This API allows the demo to render content and manage its own state, keeping it isolated from the main Deck application and other demos.

In development the dev server serves two generated modules per demo: one that re-runs the demo when its file changes, and one that carries its source text for the Source panel. In a published deck the demo is bundled ahead of time, and the Source panel still shows the original file rather than the bundle.

## Dev Servers and the Build

Deck has two modes of operation:

1.  **Development:** `deck-dev` serves a deck with no bundler and no config. Plugins for Vite (`@3sln/deck/vite-plugin`), `@web/dev-server` (`@3sln/deck/wds-plugin`) and webpack-dev-server / Rspack (`@3sln/deck/webpack-plugin`) do the same job inside a dev server you already run — and the middleware behind them is plain connect, so any Node server can host a deck. Deck's own client app is pre-bundled either way, so the host runtime is never asked to resolve Deck's own dependencies.

2.  **Production (`deck-build`):** Copies the project's documentation files, bundles demos, and writes the manifest, search index, and crawler files. By default it also bundles the stock UI and generates a static `index.html` for deployment. Use `build.ui: false` to publish the deck data and project files without the stock UI.
