# @3sln/deck

A Vite plugin for building scalable, zero-config, Markdown-based component playgrounds and documentation sites.

> [!WARNING]
> This is a work-in-progress project.

## Features

- **Scalable Backend:** Uses **IndexedDB** to index and store all documentation content on the client-side. This allows `deck` to handle hundreds or thousands of documents without a slow initial load time.
- **Vite Plugin:** A simple Vite plugin provides a zero-config development server with hot-reloading.
- **Static Site Generation:** A `deck-build` command generates a fully static, production-ready site from your project files.
- **`<deck-demo>`:** A powerful custom element for embedding live, stateful, and hot-reloading component demos directly in your documentation.
- **Reactive UI:** A modern, responsive UI with a powerful search feature and a split-screen layout for easy viewing.
- **Configurable:** The project title and import maps for dynamic demos can be configured in your project's `package.json`.

## Quick Start

1.  **Install:**
    ```bash
    npm install @3sln/deck
    ```

2.  **Configure:** In your `package.json`, add a build script and your project's configuration:
    ```json
    {
      "scripts": {
        "dev": "vite",
        "build": "deck-build"
      },
      "@3sln/deck": {
        "title": "My Awesome Docs"
      }
    }
    ```

3.  **Create a `vite.config.js`:**
    ```javascript
    import { defineConfig } from 'vite';
    import deckPlugin from '@3sln/deck/vite-plugin';

    export default defineConfig({
      plugins: [deckPlugin()],
    });
    ```

4.  **Run:**
    ```bash
    npm run dev
    ```
