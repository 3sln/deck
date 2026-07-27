# Getting Started

A Deck project is typically created as a sub-project to document a larger library or application. It's common to create the deck inside a subdirectory like `/deck` or `/docs` within your main project.

This guide assumes you are setting up a new deck in a subdirectory.

## 1. Install

```bash
npm install --save-dev @3sln/deck
```

That is the only dependency. Deck brings its own dev server and its own bundler.

## 2. Configure Your Project

In your `package.json`, add scripts and a `@3sln/deck` configuration block. You must provide a `title` for your documentation site.

```json
{
  "name": "my-cool-project-docs",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "deck-dev",
    "build": "deck-build"
  },
  "devDependencies": {
    "@3sln/deck": "^0.0.14"
  },
  "@3sln/deck": {
    "title": "My Cool Project"
  }
}
```

## 3. Add Content

Create your documentation files using Markdown (`.md`). You can organize them in any directory structure you like.

```
my-project/
├── deck/  <-- Your Deck project lives here
│   ├── docs/
│   │   ├── introduction.md
│   │   └── components/
│   │       └── button.md
│   └── package.json
└── src/ < -- Your main project code
```

## 4. Run the Dev Server

Start the development server from within your deck subdirectory and you're ready to go!

```bash
cd deck
npm run dev
```

## 5. Publish

```bash
npm run build
```

`deck-build` writes a static site to `out/`, ready for any file host.

## Using a Dev Server You Already Have

`deck-dev` is the zero-config option, but a deck can also run inside a dev server your project already uses. Each of these is a drop-in replacement for step 4.

### Vite

```javascript
// vite.config.js
import {defineConfig} from 'vite';
import deck from '@3sln/deck/vite-plugin';

export default defineConfig({plugins: [deck()]});
```

Deck uses Vite's own HMR socket here rather than opening a second one.

### @web/dev-server

```javascript
// web-dev-server.config.mjs
import deck from '@3sln/deck/wds-plugin';

export default {
  nodeResolve: true,
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

### Anything Else

Deck's dev server is a plain connect/express middleware, so express, connect, polka and Node's own `http` all work:

```javascript
import {createDeckMiddleware} from '@3sln/deck/dev-core';

app.use(createDeckMiddleware({root: process.cwd()}));
```
