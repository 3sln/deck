# Deck

> [!WARNING]
> This is a work-in-progress project.

Deck turns a directory of Markdown into a scalable, zero-config component
playground and documentation site.

It indexes your documentation in the browser, so a deck of a few thousand cards
loads as fast as a deck of five: the shell and a precompiled search index arrive
first, then cards, in whatever order the reader turns out to need them.

[deck.webm](https://github.com/user-attachments/assets/cc127ba6-202c-47f0-a982-560e05f7574d)

## Documentation & Live Examples

For a complete guide, API reference, and to see Deck in action, you can check out
Deck's own [card Deck here](https://deck.3sln.com).

## Quick Start

1.  **Install:**

    ```bash
    npm install @3sln/deck
    ```

2.  **Configure:** In your `package.json`, add scripts and your project's
    configuration:

    ```json
    {
      "scripts": {
        "dev": "deck-dev",
        "build": "deck-build"
      },
      "@3sln/deck": {
        "title": "My Awesome Docs"
      }
    }
    ```

3.  **Run:**

    ```bash
    npm run dev
    ```

That is the whole of it — `deck-dev` needs no config file and no bundler. If you
would rather run your deck inside a dev server you already use, see below.

## Dev servers

A deck needs four things from a dev server: serve the index page deck generates,
serve your cards, serve two generated modules per `<deck-demo>`, and say when a
file changed. Deck's own client app arrives pre-bundled, so nothing here depends
on how the host resolves `@3sln/dodo` or copes with a CommonJS package.

### Deck's own server

```bash
npx deck-dev --port 5173
```

No config, no dependencies. Cards hot reload, and `<deck-demo>` modules re-run in
place when you edit them.

### Vite

```javascript
// vite.config.js
import {defineConfig} from 'vite';
import deck from '@3sln/deck/vite-plugin';

export default defineConfig({plugins: [deck()]});
```

Uses Vite's own HMR socket rather than opening a second channel.

### @web/dev-server

```javascript
// web-dev-server.config.mjs
import deck from '@3sln/deck/wds-plugin';

export default {
  nodeResolve: true, // for your demo modules; deck's app is already bundled
  plugins: [deck()],
};
```

### webpack-dev-server / Rspack

```javascript
// rspack.config.js — webpack.config.js is identical
import {setupMiddlewares} from '@3sln/deck/webpack-plugin';

export default {
  mode: 'development',
  entry: {},
  devServer: {
    static: {directory: import.meta.dirname},
    setupMiddlewares: setupMiddlewares({root: import.meta.dirname}),
  },
};
```

Demos are bundled with esbuild on every path except Vite, which resolves them
through your own Vite config instead. If your demos import through an alias or a
path mapping, tell esbuild about it once:

```json
{
  "@3sln/deck": {
    "esbuild": {"alias": {"@app": "./src"}}
  }
}
```

### Anything else

The middleware behind the last two is plain connect/express, so express, connect,
polka and Node's own `http` all work the same way:

```javascript
import {createDeckMiddleware} from '@3sln/deck/dev-core';

app.use(createDeckMiddleware({root: process.cwd()}));
```

## Publishing

```bash
npx deck-build
```

Writes a static site to `out/`, ready for any file host. The build:

- bundles deck's app and every `<deck-demo>` module with esbuild;
- precompiles a **search index** over the whole deck, which the browser downloads
  before any card — so the first search covers everything, not just what has
  finished loading;
- writes `llms.txt`, `agents.md`, `agents.html`, `robots.txt` and — when `url`
  is configured — `sitemap.xml`, so a crawler or an agent that cannot run a
  single-page app can still read the whole deck;
- emits a service worker and asset manifest for offline reading.

### Loading order

A published deck decides what to fetch by priority rather than by order on disk:

1. the precompiled search index, before any card;
2. the card named by `?c=`, so a deep link opens immediately;
3. cards matching the search on screen — including a search typed while the rest
   of the deck is still downloading, which re-prioritises the queue in place;
4. everything else, in the background.

## License

MIT
