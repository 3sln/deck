/**
 * Deck as a Vite plugin.
 *
 * Everything about *a deck* — what is in it, what the index page says, what the
 * generated demo modules do — lives in `src/dev-core.js`. What is here is the
 * Vite-shaped half: its virtual module hooks, its watcher, and its HMR
 * channel, which deck uses in preference to its own because a runtime that
 * already has one should not be made to run two.
 */

import path from 'node:path';
import {
  DeckDev,
  ESM_PREFIX,
  SRC_PREFIX,
  CARD_CHANGED,
  CARD_REMOVED,
  SOURCE_CHANGED,
  MODULE_EXTENSIONS,
  parseVirtualUrl,
  viteEsmModule,
  viteSrcModule,
} from './src/dev-core.js';

export default function deckPlugin() {
  let resolvedConfig;
  let deck;

  return {
    name: 'vite-plugin-deck',

    resolveId(id) {
      if (id.startsWith(ESM_PREFIX) || id.startsWith(SRC_PREFIX)) {
        return id;
      }
      return null;
    },

    load(id) {
      const virtual = parseVirtualUrl(id);
      if (!virtual) return null;
      if (virtual.kind === 'esm') return viteEsmModule(virtual.target);
      return viteSrcModule(virtual.target);
    },

    async handleHotUpdate({file, read, server}) {
      // A demo's Source panel shows the file's text, which changes for reasons
      // Vite's module graph knows nothing about — so the notification is keyed
      // on the path on disk rather than on whatever URL the module ended up
      // with. Only modules are read: a card changing is the watcher's business.
      if (!deck || !MODULE_EXTENSIONS.has(path.extname(file))) return;
      const webPath = deck.webPathFor(file);
      if (!webPath) return;

      server.ws.send({
        type: 'custom',
        event: SOURCE_CHANGED,
        data: {path: webPath, text: await read()},
      });
    },

    configResolved(config) {
      resolvedConfig = config;
    },

    async configureServer(server) {
      deck = await new DeckDev({root: resolvedConfig.root}).init();

      server.watcher.on('all', (eventName, eventPath) => {
        const webPath = deck.webPathFor(path.resolve(eventPath));
        if (!webPath || !deck.isCard(webPath)) return;

        switch (eventName) {
          case 'add':
          case 'change':
            server.ws.send({type: 'custom', event: CARD_CHANGED, data: {path: webPath}});
            break;
          case 'unlink':
            server.ws.send({type: 'custom', event: CARD_REMOVED, data: {path: webPath}});
            break;
        }
      });

      server.middlewares.use(async (req, res, next) => {
        if (new URL(req.url, 'http://localhost').pathname !== '/') {
          next();
          return;
        }
        try {
          // `@3sln/deck` rather than a resolved path: Vite resolves the bare
          // specifier itself, which is also what puts the app through its
          // dependency optimiser.
          const template = await deck.indexHtml({entryFile: '@3sln/deck'});
          const html = await server.transformIndexHtml(req.url, template);
          res.setHeader('Content-Type', 'text/html');
          res.end(html);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}
