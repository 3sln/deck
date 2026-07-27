/**
 * Whether this page is being served by a dev server.
 *
 * A module-level flag rather than a parameter threaded through everything,
 * because the one place that needs it most — the `<deck-demo>` custom element —
 * is constructed by the parser out of a card body, not called by deck. It is
 * set once by `renderDeck`, before any card is rendered.
 *
 * `import.meta.hot` cannot answer this on its own: only Vite defines it, and
 * deck now runs under dev servers that do not.
 */

let devMode = false;

export function setDevMode(value) {
  devMode = !!value;
}

export function isDev() {
  return devMode;
}
