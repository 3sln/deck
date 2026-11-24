# Deck

> [!WARNING]
> This is a work-in-progress project.

Deck turns a directory of Markdown into a scalable, zero-config component
playground and documentation site.

Deck compiles a search index ahead of time and loads cards as readers open them.
Use the stock UI, embed it in another site, or use the deck data in your own UI.
You can combine projects, offer version selectors, and serve the same cards over MCP.

[deck.webm](https://github.com/user-attachments/assets/cc127ba6-202c-47f0-a982-560e05f7574d)

## Documentation & Live Examples

For a complete guide, API reference, and to see Deck in action, you can check out
Deck's own [card Deck here](https://deck.3sln.com).

The [configuration reference](deck/cards/configuration.md) covers branding,
themes, and selectors for projects and versions. The [integration guide](deck/cards/integration.md)
covers the headless API, embedding, and MCP.

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
- writes `deck-manifest.json` and `deck-search-index.json` alongside the card
  files for the stock UI, custom clients, and MCP;
- writes `llms.txt`, `agents.md`, `agents.html`, `robots.txt` and — when `url`
  is configured — `sitemap.xml`, so a crawler or an agent that cannot run a
  single-page app can still read the whole deck;
- emits a service worker and asset manifest for the stock UI's offline shell.
  Readers can save individual cards or entire projects for offline reading.

Set `build.ui` to `false` to build the deck data without the stock UI.

## Releasing Deck

Increase the root `package.json` version and merge it to `main`. The release
workflow runs the tests, publishes to npm, and creates a GitHub release for
`v<version>`. Prereleases use npm's `next` tag.

The workflow can use the `NPM_TOKEN` repository secret or npm trusted publishing.
For trusted publishing, authorize `publish.yml` in the `@3sln/deck` npm package
settings and enable direct `npm publish`. [npm trusted publishing setup](https://docs.npmjs.com/trusted-publishers/)

## License

MIT
