# Introduction to Deck

Deck turns a directory of Markdown into a scalable, zero-config component playground and documentation site.

It is designed to handle hundreds or even thousands of documentation files without a slow initial load time, making it ideal for large projects and component libraries.

## Core Features

- **Scalable Backend:** Uses **IndexedDB** to store documentation content on the client-side, so the browser only loads the content it needs, when it needs it.
- **Precompiled Search:** A published deck ships a search index built at publish time and downloaded before any card. The first search covers the whole deck, not just the part that happens to have loaded.
- **Priority Loading:** A deep-linked card arrives first, cards matching the search on screen arrive next — including a search typed while the rest of the deck is still downloading — and everything else fills in behind them.
- **Runs Anywhere:** `deck-dev` needs no bundler and no config. Plugins are also available for Vite, `@web/dev-server`, and webpack-dev-server / Rspack.
- **Static Site Generation:** A `deck-build` command generates a fully static, production-ready site that can be hosted on any static hosting provider.
- **`<deck-demo>`:** A powerful custom element for embedding live, stateful, and hot-reloading component demos directly in your documentation.
- **Agent-Readable:** Every build writes `agents.md` and `agents.html` — the whole deck as one document, with demo sources inlined — for LLM agents that cannot run a single-page app.
- **Offline Support:** After the first visit, the entire site shell and all visited cards are cached for offline use. Live demos that have been previously viewed will also work offline.
