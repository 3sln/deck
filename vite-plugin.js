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

    config() {
      return {optimizeDeps: {exclude: ['@3sln/deck']}};
    },

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
      const {base} = resolvedConfig;

      const update = (eventName, eventPath) => {
        const webPath = deck.webPathFor(path.resolve(eventPath));
        if (!webPath) return;

        switch (eventName) {
          case 'add':
          case 'change':
            if (!deck.isCard(webPath)) return;
            deck.invalidateArtifacts(webPath);
            server.ws.send({type: 'custom', event: CARD_CHANGED, data: {path: webPath}});
            break;
          case 'unlink':
            if (!/\.(md|html)$/.test(webPath)) return;
            deck.invalidateArtifacts(webPath);
            server.ws.send({type: 'custom', event: CARD_REMOVED, data: {path: webPath}});
            break;
        }
      };
      server.watcher.on('all', update);
      server.httpServer?.once('close', () => server.watcher.off('all', update));

      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (!pathname.startsWith(base)) return next();
        const route = '/' + pathname.slice(base.length);
        try {
          const artifact = await deck.artifactResponse(route);
          if (artifact) {
            res.statusCode = artifact.status ?? 200;
            res.setHeader('Content-Type', artifact.type + '; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            return res.end(req.method === 'HEAD' ? undefined : artifact.body);
          }
          if (route !== '/' || deck.config.ui === false) return next();
          const template = await deck.indexHtml({entryFile: '@3sln/deck'});
          const html = await server.transformIndexHtml('/', template, req.url);
          res.setHeader('Content-Type', 'text/html');
          res.end(req.method === 'HEAD' ? undefined : html);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}
