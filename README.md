# Deck

> [!WARNING]
> This is a work-in-progress project.

Deck is a Vite-based tool for creating scalable, zero-config, Markdown-based component playgrounds and documentation sites.

It uses a client-side database to index your documentation, enabling a fast initial load and powerful full-text search, even for very large projects.

> **TODO:** Add screen recording of the Deck UI and features.

## Documentation & Live Examples

For a complete guide, API reference, and to see Deck in action, please visit the official documentation site:

**[https://deck.3sln.com](https://deck.3sln.com)**

## Quick Start

1.  **Install:**
    ```bash
    npm install @3sln/deck
    ```

2.  **Configure:** In your `package.json`, add a build script and your project's configuration:
    ```json
    {
      ...
      "scripts": {
        "dev": "vite",
        "build": "deck-build"
      },
      "@3sln/deck": {
        "title": "My Awesome Docs"
      }
      ...
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
