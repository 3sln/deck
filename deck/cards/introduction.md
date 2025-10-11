# Introduction to Deck

Deck is a Vite-based tool for creating scalable, zero-config, Markdown-based component playgrounds and documentation sites.

It is designed to handle hundreds or even thousands of documentation files without a slow initial load time, making it ideal for large projects and component libraries.

## Core Features

- **Scalable Backend:** Uses **IndexedDB** to index and store all documentation content on the client-side. This means the browser only loads the content it needs, when it needs it.
- **Vite Plugin:** A simple Vite plugin provides a zero-config development server with hot-reloading for a fast and fluid writing experience.
- **Static Site Generation:** A `deck-build` command generates a fully static, production-ready site from your project files that can be hosted on any static hosting provider.
- **`<deck-demo>`:** A powerful custom element for embedding live, stateful, and hot-reloading component demos directly in your documentation.
- **Offline Support:** After the first visit, the entire site shell and all visited cards are cached for offline use. Live demos that have been previously viewed will also work offline.
