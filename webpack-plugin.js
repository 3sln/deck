/**
 * Deck for webpack-dev-server and Rspack.
 *
 *     // rspack.config.js / webpack.config.js
 *     const deck = require('@3sln/deck/webpack-plugin');
 *
 *     module.exports = {
 *       devServer: {
 *         setupMiddlewares: deck.setupMiddlewares({root: __dirname}),
 *         static: {directory: __dirname},
 *       },
 *     };
 *
 * There is no compilation hook here on purpose. A deck is Markdown files and
 * plain ES modules the browser loads by URL, and deck's own app arrives
 * bundled — so there is nothing for a bundler to bundle. What webpack-dev-server
 * is genuinely useful for is being the server, and that is what this uses it
 * for: deck's middleware answers for the index page, its app, the generated
 * demo modules and the events channel; dev-server's own static handling serves
 * the cards.
 *
 * The same middleware works under express, connect, polka and Node's own
 * `http`; see `@3sln/deck/dev-core` and the `deck-dev` binary.
 */

import {createDeckMiddleware} from './src/dev-middleware.js';

export {createDeckMiddleware};

/**
 * Builds a `devServer.setupMiddlewares` callback that puts deck in front.
 *
 * In front, not behind: dev-server's static handler would answer `/` with a
 * directory listing or a 404 before deck ever saw it.
 */
export function setupMiddlewares({root = process.cwd()} = {}) {
  const deck = createDeckMiddleware({root});
  return (middlewares, devServer) => {
    devServer?.app?.on?.('close', () => deck.close());
    return [{name: 'deck', middleware: deck}, ...middlewares];
  };
}

export default {createDeckMiddleware, setupMiddlewares};
