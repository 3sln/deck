# Getting Started

A Deck project is typically created as a sub-project to document a larger library or application. It's common to create the deck inside a subdirectory like `/deck` or `/docs` within your main project.

This guide assumes you are setting up a new deck in a subdirectory.

## 1. Install Dependencies

First, add `vite` and `@3sln/deck` to your project.

```bash
npm install --save-dev vite @3sln/deck
```

## 2. Configure Your Project

In your `package.json`, add a `dev` script and a `@3sln/deck` configuration block. You must provide a `title` for your documentation site.

```json
{
  "name": "my-cool-project-docs",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite"
  },
  "devDependencies": {
    "vite": "^5.4.20",
    "@3sln/deck": "^0.0.6"
  },
  "@3sln/deck": {
    "title": "My Cool Project"
  }
}
```

## 3. Create a Vite Config

Create a `vite.config.js` file in your project root and add the Deck plugin.

```javascript
import { defineConfig } from 'vite';
import deck from '@3sln/deck/vite-plugin';

export default defineConfig({
  plugins: [deck()],
});
```

## 4. Add Content

Create your documentation files using Markdown (`.md`). You can organize them in any directory structure you like.

```
my-project/
├── deck/  <-- Your Deck project lives here
│   ├── docs/
│   │   ├── introduction.md
│   │   └── components/
│   │       └── button.md
│   ├── package.json
│   └── vite.config.js
└── src/ < -- Your main project code
```

## 5. Run the Dev Server

Start the development server from within your deck subdirectory and you're ready to go!

```bash
cd deck
npm run dev
```
