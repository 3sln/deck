/**
 * The part of a deck dev server that has nothing to do with which dev server it
 * is.
 *
 * Deck used to be a Vite plugin, so "run a deck" and "run Vite" were the same
 * sentence. They are not: what a deck actually needs from a dev server is
 * small — serve an index page it generates, tell the browser when a card file
 * changed, and serve two virtual modules that give a `<deck-demo>` hot
 * reloading. Everything else is the runtime's own job.
 *
 * That small surface lives here, so `vite-plugin.js`, `wds-plugin.js` and
 * anything added later are thin adapters rather than three copies of deck.
 *
 * ## The two virtual modules
 *
 * A `<deck-demo src="/demos/x.js">` wants two things from `/demos/x.js`: the
 * module, re-run with its last arguments whenever it changes, and its source
 * text, for the Source tab. Neither is what a plain import gives you, so both
 * are served as generated modules:
 *
 *   - `/@deck-dev-esm/<encoded path>` — imports the real module and re-imports
 *     it on change, re-running the previous invocation under a fresh
 *     `AbortSignal` so the old one can tear itself down.
 *   - `/@deck-dev-src/<encoded path>.js` — the source text as a subscribable,
 *     with the current text inlined so the first render needs no round trip.
 *
 * Vite implements both against its own HMR API. Everything else uses the
 * server-sent-events channel below, which needs no bundler, no WebSocket
 * library and no cooperation from the host runtime beyond "let me answer a
 * request".
 */

import fs from 'fs-extra';
import nodeFs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadDeckConfig, getCardFiles, sha256, getHtmlTemplate, toWebPath} from './config.js';

export const EVENTS_PATH = '/@deck-dev/events';
export const CLIENT_PATH = '/@deck-dev/client.js';
export const APP_PATH = '/@deck-dev/app.js';
export const BUNDLE_PREFIX = '/@deck-dev/bundle/';
export const ESM_PREFIX = '/@deck-dev-esm/';
export const SRC_PREFIX = '/@deck-dev-src/';

/**
 * Appended to every source-module request, and stripped again on the way in.
 *
 * A dev server decides how to handle a request partly by its extension, and a
 * demo's source file is not always JavaScript: `canonical-src` exists precisely
 * so a demo compiled from ClojureScript can show the `.cljs` it was written in.
 * Vite routes `/@deck-dev-src/…custom-dodo.cljs` to static file serving rather
 * than through its plugin container, and answers 404 — the module deck is
 * generating never gets a chance to exist.
 *
 * Ending every such URL in `.js` makes the request look like what it is: a
 * JavaScript module, whatever the file it wraps happens to be.
 */
export const SRC_SUFFIX = '.js';

export const CARD_CHANGED = 'deck:card-changed';
export const CARD_REMOVED = 'deck:card-removed';
export const MODULE_CHANGED = 'deck:module-changed';
export const SOURCE_CHANGED = 'deck:source-changed';

/** Recognises a request for one of the generated modules. */
export function parseVirtualUrl(url) {
  const pathname = url.startsWith('/') ? url.split('?')[0] : new URL(url, 'http://d').pathname;

  if (pathname.startsWith(ESM_PREFIX)) {
    return {kind: 'esm', target: decodeURIComponent(pathname.slice(ESM_PREFIX.length))};
  }
  if (pathname.startsWith(SRC_PREFIX)) {
    // The `.js` the request carries is deck's, not the file's, and comes off
    // again here. See SRC_SUFFIX for why it is there at all.
    const encoded = pathname.slice(SRC_PREFIX.length).replace(/\.js$/, '');
    return {kind: 'src', target: decodeURIComponent(encoded)};
  }
  if (pathname.startsWith(BUNDLE_PREFIX)) {
    return {kind: 'bundle', target: decodeURIComponent(pathname.slice(BUNDLE_PREFIX.length))};
  }
  return null;
}

const json = value => JSON.stringify(value);

/**
 * The demo-module proxy, in Vite's dialect.
 *
 * Vite can re-evaluate a module in place, so the proxy accepts its own update
 * and re-runs the new default export rather than re-importing by URL.
 */
export function viteEsmModule(realPath) {
  return `
import realModule from ${json(realPath)};

let lastArgs = import.meta.hot?.data.lastArgs;
let abortController = new AbortController();

const run = (fn, args) => {
  const thisContext = {signal: abortController.signal};
  fn.call(thisContext, ...args);
};

export default (...args) => {
  lastArgs = args;
  run(realModule, args);
};

if (import.meta.hot) {
  import.meta.hot.dispose(data => {
    data.lastArgs = lastArgs;
    abortController.abort();
  });

  import.meta.hot.accept(newModule => {
    if (newModule?.default && lastArgs) {
      abortController = new AbortController();
      run(newModule.default, lastArgs);
    }
  });
}
`;
}

/**
 * The source-text module, in Vite's dialect.
 *
 * The initial text comes from a `?raw` import; updates arrive as a custom
 * server event keyed on the *file path*. Keying on the `?raw` module's URL
 * instead looks natural and does not work: what deck can construct is
 * `/demos/x?raw`, and what ends up in Vite's module graph is whatever Vite
 * normalised it to — so the comparison silently never matched and the Source
 * panel sat on the version it was first served.
 */
export function viteSrcModule(realPath) {
  const rawPath = `${realPath}?raw`;

  return `
import moduleText from ${json(rawPath)};

let text = moduleText;
const observers = import.meta.hot?.data.observers ?? new Set();

export const moduleText$ = {
  subscribe(observerOrNext) {
    const observer = typeof observerOrNext === 'function' ? {next: observerOrNext} : observerOrNext;
    observer?.next?.(text);
    observers.add(observer);
    return {unsubscribe: () => observers.delete(observer)};
  },
};

if (import.meta.hot) {
  // Self-accepting, so a change to the wrapped file does not escalate into a
  // full page reload while the reader is halfway through a demo.
  import.meta.hot.accept();
  import.meta.hot.dispose(data => {
    data.observers = observers;
  });

  import.meta.hot.on(${json(SOURCE_CHANGED)}, event => {
    if (event.path !== ${json(realPath)}) return;
    text = event.text;
    for (const observer of [...observers]) observer?.next?.(text);
  });
}
`;
}

/**
 * The demo-module proxy for runtimes that serve native ES modules.
 *
 * There is no module-replacement API to hook, so a change re-imports the real
 * module under a new query string — a new URL is a new module to the browser —
 * and re-runs it with the arguments the demo was last called with.
 */
export function nativeEsmModule(realPath) {
  const bundleUrl = `${BUNDLE_PREFIX}${encodeURIComponent(realPath)}`;

  return `
import {onDeckEvent} from ${json(CLIENT_PATH)};

const target = ${json(realPath)};
const bundle = version => \`${bundleUrl}?v=\${version}\`;

let current = await import(/* webpackIgnore: true */ bundle(0));
let lastArgs = null;
let abortController = new AbortController();

const run = fn => {
  abortController.abort();
  abortController = new AbortController();
  fn.call({signal: abortController.signal}, ...lastArgs);
};

export default (...args) => {
  lastArgs = args;
  run(current.default);
};

onDeckEvent(${json(MODULE_CHANGED)}, async ({path, version}) => {
  if (path !== target) return;
  // A new URL is a new module to the browser; there is no module-replacement
  // API to hook when nothing is bundling the page.
  current = await import(/* webpackIgnore: true */ bundle(version));
  if (lastArgs && current.default) run(current.default);
});
`;
}

/**
 * Bundles one demo module on demand.
 *
 * A demo is the user's own code and imports whatever it likes — `@3sln/dodo`,
 * something from npm that only ships CommonJS. Under Vite that is Vite's
 * problem and Vite solves it. Under a server that hands out files as they are,
 * it is nobody's, and the demo simply fails to load. So deck bundles it, with
 * the bundler it already carries.
 *
 * Each demo gets its own bundle, which means its own copy of any library it
 * imports. That is fine here: a demo renders into its own shadow root through
 * its own `reconcile`, and shares no component identity with deck's app.
 */
export async function bundleModule(root, webPath, options = {}) {
  const esbuild = await import('esbuild');
  const entry = path.join(root, webPath.replace(/^\//, ''));

  const result = await esbuild.build({
    entryPoints: [entry],
    absWorkingDir: root,
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    sourcemap: 'inline',
    logOverride: {'unsupported-dynamic-import': 'silent'},
    ...demoBuildOptions(options),
  });

  return result.outputFiles[0].text;
}

/**
 * The parts of an esbuild config a deck may set for its demos.
 *
 * Under the Vite plugin a demo is resolved by the user's own Vite config, so
 * an alias or a path mapping just works. Everywhere else deck bundles the demo
 * itself and would otherwise have no idea what `@app/button` means. This is the
 * seam: an `esbuild` block in the deck's config, passed through.
 *
 *     "@3sln/deck": {
 *       "esbuild": {
 *         "alias": {"@app": "./src"},
 *         "define": {"__DEV__": "true"}
 *       }
 *     }
 *
 * Deliberately a fixed list rather than a spread of whatever is in the config:
 * `write`, `format` and `entryPoints` are deck's to decide, and letting a config
 * file overwrite them turns a typo into a dev server that serves nothing.
 */
const DEMO_BUILD_KEYS = [
  'alias',
  'define',
  'external',
  'inject',
  'jsx',
  'jsxDev',
  'jsxFactory',
  'jsxFragment',
  'jsxImportSource',
  'loader',
  'mainFields',
  'conditions',
  'nodePaths',
  'resolveExtensions',
  'supported',
  'target',
  'tsconfig',
  'tsconfigRaw',
];

export function demoBuildOptions(options = {}) {
  const picked = {};
  for (const key of DEMO_BUILD_KEYS) {
    if (options[key] !== undefined) picked[key] = options[key];
  }
  return picked;
}

/**
 * The source-text module for runtimes with no `?raw` import.
 *
 * The current text is inlined rather than fetched, so the Source tab has
 * something to show on the first frame instead of "Loading...".
 */
export function nativeSrcModule(realPath, text) {
  return `
import {onDeckEvent} from ${json(CLIENT_PATH)};

const target = ${json(realPath)};
let text = ${json(text)};
const observers = new Set();

export const moduleText$ = {
  subscribe(observerOrNext) {
    const observer = typeof observerOrNext === 'function' ? {next: observerOrNext} : observerOrNext;
    observer?.next?.(text);
    observers.add(observer);
    return {unsubscribe: () => observers.delete(observer)};
  },
};

onDeckEvent(${json(SOURCE_CHANGED)}, event => {
  if (event.path !== target) return;
  text = event.text;
  for (const observer of [...observers]) observer?.next?.(text);
});
`;
}

/**
 * The browser half of the events channel: one `EventSource` shared by the deck
 * and by every generated module, since browsers cap concurrent connections per
 * origin at around six and a deck can hold rather more than six demos.
 */
export function clientModule() {
  return `
const listeners = new Map();
let source = null;

const connect = () => {
  if (source) return;
  source = new EventSource(${json(EVENTS_PATH)});
  source.addEventListener('deck', event => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    for (const listener of listeners.get(message.event) ?? []) {
      try {
        listener(message.data);
      } catch (err) {
        console.error('Deck: error in dev event listener', err);
      }
    }
  });
  // EventSource reconnects on its own; this is only here so a dev server
  // restart is visible in the console rather than silently missing events.
  source.addEventListener('error', () => console.debug('Deck: dev channel reconnecting…'));
};

export function onDeckEvent(name, listener) {
  connect();
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(listener);
  return () => listeners.get(name)?.delete(listener);
}
`;
}

let appBundle = null;

/**
 * Deck's own client app, bundled.
 *
 * Vite does not need this — it pre-bundles dependencies itself — but a dev
 * server that serves files as they are on disk does. Not because of bare
 * specifiers, which `nodeResolve` handles, but because highlight.js's "ES
 * module" build is a three-line shim that imports its CommonJS build. Packages
 * shaped like that only work through a bundler, and asking every deck user to
 * add a CommonJS rollup plugin to their dev server config to run *deck's* code
 * is asking them to solve deck's problem.
 *
 * So deck brings its own bundler — the one it already uses to publish — and the
 * host runtime is left with the job it is actually good at: serving the user's
 * cards and demo modules. Built once per server start and cached; deck's source
 * does not change while someone is writing documentation with it.
 */
export async function buildAppBundle({minify = false} = {}) {
  if (appBundle) return appBundle;

  const esbuild = await import('esbuild');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const result = await esbuild.build({
    entryPoints: [path.join(here, 'main.js')],
    absWorkingDir: path.dirname(here),
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    minify,
    sourcemap: 'inline',
    logOverride: {'unsupported-dynamic-import': 'silent'},
  });

  appBundle = result.outputFiles[0].text;
  return appBundle;
}

/** A server-sent-events hub. One `broadcast` reaches every open tab. */
export class EventChannel {
  #clients = new Set();

  /** Attaches a node response as a client. Returns once it is streaming. */
  addClient(res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nothing sits between the dev server and the browser in development,
      // but a proxy that buffers would hold every event until the stream ends.
      'X-Accel-Buffering': 'no',
    });
    res.write(': deck dev channel\n\n');
    this.#clients.add(res);
    res.on('close', () => this.#clients.delete(res));
  }

  broadcast(event, data) {
    const payload = `event: deck\ndata: ${JSON.stringify({event, data})}\n\n`;
    for (const client of this.#clients) {
      try {
        client.write(payload);
      } catch {
        this.#clients.delete(client);
      }
    }
  }

  close() {
    for (const client of this.#clients) client.end();
    this.#clients.clear();
  }
}

/**
 * A deck, as a dev server sees it.
 *
 * Deliberately holds no server: an adapter creates one of these, asks it what
 * to serve, and hands the answers to whatever server it is adapting.
 */
export class DeckDev {
  #root;
  #config = null;
  #mode;

  constructor({root, mode = 'dev'}) {
    this.#root = root;
    this.#mode = mode;
  }

  async init() {
    const config = await loadDeckConfig(this.#root);
    this.#config = this.#mode === 'build' ? config.build : config.dev;
    return this;
  }

  get root() {
    return this.#root;
  }

  get config() {
    if (!this.#config) throw new Error('DeckDev.init() has not been awaited');
    return this.#config;
  }

  /** Every card in the deck, as `{path, hash}`. */
  async cardManifest() {
    const files = getCardFiles(this.#root, this.config);
    return await Promise.all(
      files.map(async file => {
        const webPath = toWebPath(file);
        const content = await fs.readFile(path.join(this.#root, file), 'utf-8');
        return {path: webPath, hash: await sha256(content)};
      }),
    );
  }

  /** Whether a web path is one of this deck's cards. */
  isCard(webPath) {
    return getCardFiles(this.#root, this.config).some(file => toWebPath(file) === webPath);
  }

  /** The web path for an absolute file path, or null if it is outside the deck. */
  webPathFor(absolutePath) {
    const relative = path.relative(this.#root, absolutePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return toWebPath(relative);
  }

  async indexHtml({entryFile, headExtra = ''} = {}) {
    const config = this.config;
    return getHtmlTemplate({
      title: config.title,
      importMap: config.importMap,
      initialCardsData: await this.cardManifest(),
      pinnedCardPaths: config.pinned,
      entryFile,
      favicon: config.favicon,
      scripts: config.scripts,
      stylesheets: config.stylesheets,
      // Dev has no precompiled index: the deck is being edited, and an index
      // built a moment ago already describes the previous version.
      searchIndexUrl: null,
      dev: true,
      headExtra,
    });
  }

  readSource(webPath) {
    return fs.readFile(path.join(this.#root, webPath.replace(/^\//, '')), 'utf-8');
  }
}

const IGNORED_DIRS = /(^|[\\/])(node_modules|\.git)([\\/]|$)/;
export const MODULE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.cljs',
  '.cljc',
]);

/**
 * Watches a deck and reports what changed, in deck's own vocabulary.
 *
 * Deck brings its own watcher rather than borrowing the host runtime's because
 * every runtime's differs, and because deck watches for reasons the runtime
 * does not share: a Markdown file is not a module to a bundler, and a demo's
 * source *text* changing matters even when the module graph is unaffected.
 *
 * Editors write files in bursts — a temp file, a rename, a truncate — so
 * changes are debounced and collapsed per path.
 */
export function watchDeck(deck, {onEvent, debounceMs = 40}) {
  let version = 0;
  const pending = new Map();
  let timer = null;

  const flush = async () => {
    timer = null;
    const changes = [...pending.entries()];
    pending.clear();

    for (const [absolutePath, kind] of changes) {
      const webPath = deck.webPathFor(absolutePath);
      if (!webPath) continue;

      const exists = nodeFs.existsSync(absolutePath);
      if (deck.isCard(webPath) || (!exists && /\.(md|html)$/.test(webPath))) {
        onEvent(exists ? CARD_CHANGED : CARD_REMOVED, {path: webPath});
        continue;
      }

      if (!exists || !MODULE_EXTENSIONS.has(path.extname(webPath))) continue;
      onEvent(MODULE_CHANGED, {path: webPath, version: ++version});
      try {
        onEvent(SOURCE_CHANGED, {path: webPath, text: await deck.readSource(webPath)});
      } catch {
        // Raced with a delete; the module event above is still worth sending.
      }
      void kind;
    }
  };

  const watcher = nodeFs.watch(deck.root, {recursive: true}, (eventType, filename) => {
    if (!filename || IGNORED_DIRS.test(filename)) return;
    pending.set(path.resolve(deck.root, filename), eventType);
    if (timer === null) timer = setTimeout(flush, debounceMs);
  });

  return {
    close() {
      if (timer !== null) clearTimeout(timer);
      watcher.close();
    },
  };
}
