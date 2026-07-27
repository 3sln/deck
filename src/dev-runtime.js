/**
 * The browser's end of "am I running under a dev server, and how do I hear
 * about changes?".
 *
 * Two transports, one interface. Vite gives every module an `import.meta.hot`
 * that already carries custom server events, so under Vite deck uses it and
 * opens nothing of its own. Every other dev runtime gets deck's server-sent
 * events channel, which the dev core serves and which needs no bundler support
 * at all.
 *
 * A production build has neither, and `connectHmr` returns a channel that never
 * fires — so the calling code has no branch in it.
 */

import {isDev} from './dev-mode.js';

const CLIENT_PATH = '/@deck-dev/client.js';

const NO_CHANNEL = {kind: 'none', on: () => () => {}};

export async function connectHmr({dev = isDev()} = {}) {
  if (import.meta.hot) {
    const hot = import.meta.hot;
    return {kind: 'vite', on: (event, listener) => hot.on(event, listener)};
  }

  if (!dev) return NO_CHANNEL;

  try {
    // A computed specifier, so a bundler leaves it alone: this path only
    // exists while a dev server is answering for it.
    const url = new URL(CLIENT_PATH, document.baseURI).href;
    const {onDeckEvent} = await import(/* @vite-ignore */ /* webpackIgnore: true */ url);
    return {kind: 'sse', on: onDeckEvent};
  } catch (err) {
    console.warn('Deck: no dev event channel; card changes will not hot reload.', err);
    return NO_CHANNEL;
  }
}
