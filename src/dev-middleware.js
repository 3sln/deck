/**
 * Deck as a plain Node middleware: `(req, res, next)`.
 *
 * This is the smallest useful shape a deck dev server has. Everything a deck
 * needs from its host — the index page, deck's own bundled app, the two
 * generated demo modules and the events channel — is answered here, and
 * anything else is handed straight back with `next()`. Which means any server
 * that speaks the connect/express middleware convention can host a deck:
 *
 *     // webpack-dev-server / rspack
 *     devServer: {
 *       setupMiddlewares: (middlewares) => [deckMiddleware(), ...middlewares],
 *     }
 *
 *     // express, connect, polka
 *     app.use(deckMiddleware());
 *
 * @web/dev-server gets its own plugin instead — Koa is not connect, and WDS's
 * plugin API is a better fit there. Vite gets its own too, because Vite already
 * has an HMR socket and deck should use it rather than open a second one.
 *
 * The host is left with exactly one job: serving the user's own files. Deck's
 * client is bundled here (see `buildAppBundle`) precisely so the host is not
 * asked to resolve deck's dependencies.
 */

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
} from './dev-core.js';

const send = (res, body, type) => {
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  res.end(body);
};

/**
 * @param {object} options
 * @param {string} options.root  the deck's directory
 * @returns a middleware, with `.close()` for shutting the watcher down.
 */
export function createDeckMiddleware({root = process.cwd()} = {}) {
  const channel = new EventChannel();
  let deck = null;
  let watcher = null;

  // Started on the first request rather than up front, so constructing the
  // middleware stays synchronous and a server that is never hit never watches.
  let readyPromise = null;
  const ready = () => {
    if (!readyPromise) {
      readyPromise = new DeckDev({root}).init().then(instance => {
        deck = instance;
        watcher = watchDeck(deck, {onEvent: (event, data) => channel.broadcast(event, data)});
        return deck;
      });
    }
    return readyPromise;
  };

  const middleware = async (req, res, next) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;

    if (pathname === EVENTS_PATH) {
      channel.addClient(res);
      return;
    }

    try {
      if (pathname === CLIENT_PATH) {
        send(res, clientModule(), 'text/javascript; charset=utf-8');
        return;
      }

      if (pathname === APP_PATH) {
        send(res, await buildAppBundle(), 'text/javascript; charset=utf-8');
        return;
      }

      const virtual = parseVirtualUrl(pathname);
      if (virtual) {
        await ready();
        if (virtual.kind === 'esm') {
          send(res, nativeEsmModule(virtual.target), 'text/javascript; charset=utf-8');
          return;
        }
        if (virtual.kind === 'bundle') {
          send(res, await bundleModule(root, virtual.target), 'text/javascript; charset=utf-8');
          return;
        }
        let text = '';
        try {
          text = await deck.readSource(virtual.target);
        } catch (err) {
          text = `// Deck could not read ${virtual.target}: ${err.message}`;
        }
        send(res, nativeSrcModule(virtual.target, text), 'text/javascript; charset=utf-8');
        return;
      }

      if (pathname === '/' || pathname === '/index.html') {
        await ready();
        send(res, await deck.indexHtml({entryFile: APP_PATH}), 'text/html; charset=utf-8');
        return;
      }
    } catch (err) {
      if (next) {
        next(err);
      } else {
        res.writeHead(500, {'Content-Type': 'text/plain'});
        res.end(String(err?.stack ?? err));
      }
      return;
    }

    next?.();
  };

  middleware.close = () => {
    watcher?.close();
    channel.close();
  };

  return middleware;
}
