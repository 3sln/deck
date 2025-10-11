# Deck

> [!WARNING]
> This is a work-in-progress project.

Deck is a Vite-based tool for creating scalable, zero-config, Markdown-based component playgrounds and documentation sites.

It uses a client-side database to index your documentation, enabling a fast initial load and powerful full-text search, even for very large projects.

[deck.webm](https://github.com/user-attachments/assets/cc127ba6-202c-47f0-a982-560e05f7574d)

## Documentation & Live Examples

For a complete guide, API reference, and to see Deck in action, you can check out Deck's own
[card Deck here](https://deck.3sln.com).

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
