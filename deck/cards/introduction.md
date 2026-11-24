---
tags: [getting started]
---

# Introduction to Deck

Deck turns a directory of Markdown into a scalable, zero-config component playground and documentation site.

It is designed to handle hundreds or even thousands of documentation files without a slow initial load time, making it ideal for large projects and component libraries.

## Core Features

- **Prebuilt search:** Search across card titles, tags, and full text with a published index. Card bodies load on demand.
- **Embeddable and composable:** Use your own UI or brand the stock UI. Readers can choose which projects to include when exploring a composed deck.
- **Runs Anywhere:** `deck-dev` needs no bundler and no config. Plugins are also available for Vite, `@web/dev-server`, and webpack-dev-server / Rspack.
- **Static Site Generation:** A `deck-build` command generates a fully static, production-ready site that can be hosted on any static hosting provider.
- **`<deck-demo>`:** A powerful custom element for embedding live, stateful, and hot-reloading component demos directly in your documentation.
- **Agent-Readable:** Every build writes `agents.md` and `agents.html` — the whole deck as one document, with demo sources inlined — for LLM agents that cannot run a single-page app.
- **Offline reading:** Readers choose which cards or projects to save for offline use.
- **Documentation MCP:** Serve the same cards to MCP clients from the published manifest.
