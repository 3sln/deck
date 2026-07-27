/**
 * Deck as a `@web/dev-server` plugin.
 *
 *     // web-dev-server.config.mjs
 *     import deck from '@3sln/deck/wds-plugin';
 *
 *     export default {
 *       nodeResolve: true,
 *       plugins: [deck()],
 *     };
 *
 * `nodeResolve` is for *your* demo modules — deck's own app arrives pre-bundled
 * (see `buildAppBundle`), so nothing here depends on how the server resolves
 * `@3sln/dodo`. Leave it out if your demos import nothing by bare specifier.
 *
 * Where the Vite plugin borrows Vite's HMR socket, this one uses deck's own
 * server-sent-events channel from the dev core — @web/dev-server's socket
 * belongs to its own reload machinery, and a dev server should not have to grow
 * a plugin API for deck's sake.
 */

import path from 'node:path';
import {
  DeckDev,
  EventChannel,
  watchDeck,
  parseVirtualUrl,
  clientModule,
  nativeEsmModule,
  nativeSrcModule,
  buildAppBundle,
  bundleModule,
  EVENTS_PATH,
  CLIENT_PATH,
  APP_PATH,
} from './src/dev-core.js';

export default function deckPlugin() {
  let deck;
  let channel;
  let watcher;

  return {
    name: 'deck',

    async serverStart({app, config, server}) {
      deck = await new DeckDev({root: path.resolve(config.rootDir)}).init();
      channel = new EventChannel();
      watcher = watchDeck(deck, {onEvent: (event, data) => channel.broadcast(event, data)});

      // Server-sent events need the raw response: the stream is the reply, and
      // Koa's own response handling would close it after the first write.
      app.use(async (ctx, next) => {
        if (ctx.path !== EVENTS_PATH) {
          await next();
          return;
        }
        ctx.respond = false;
        channel.addClient(ctx.res);
      });

      server.on('close', () => {
        watcher?.close();
        channel?.close();
      });
    },

    async serverStop() {
      watcher?.close();
      channel?.close();
    },

    async serve(context) {
      if (context.path === CLIENT_PATH) {
        return {body: clientModule(), type: 'js'};
      }

      if (context.path === APP_PATH) {
        return {body: await buildAppBundle(), type: 'js'};
      }

      const virtual = parseVirtualUrl(context.path);
      if (virtual) {
        if (virtual.kind === 'esm') {
          return {body: nativeEsmModule(virtual.target), type: 'js'};
        }
        if (virtual.kind === 'bundle') {
          return {body: await bundleModule(deck.root, virtual.target), type: 'js'};
        }
        let text = '';
        try {
          text = await deck.readSource(virtual.target);
        } catch (err) {
          text = `// Deck could not read ${virtual.target}: ${err.message}`;
        }
        return {body: nativeSrcModule(virtual.target, text), type: 'js'};
      }

      if (context.path === '/' || context.path === '/index.html') {
        return {body: await deck.indexHtml({entryFile: APP_PATH}), type: 'html'};
      }

      return undefined;
    },
  };
}
