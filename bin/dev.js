#!/usr/bin/env node

/**
 * `deck-dev` — a deck dev server with no bundler under it.
 *
 * Deck's own app is bundled by deck (see `buildAppBundle`), and a deck's
 * content is Markdown and plain ES modules, so the whole of what a host runtime
 * has to do is serve files. That is small enough to do here, which makes a deck
 * runnable with no dev dependency at all:
 *
 *     npx deck-dev
 *
 * Card changes and demo hot reloading work exactly as they do under Vite and
 * @web/dev-server — the same events, over the same channel (see
 * `src/dev-core.js`).
 *
 * Demo modules are served as they are on disk, so a demo that imports by bare
 * specifier needs an `importMap` in the deck's config. Deck's own app does not:
 * it arrives bundled.
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createDeckMiddleware} from '../src/dev-middleware.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const root = path.resolve(flag('root', process.cwd()));
const port = Number(flag('port', 5173));
const host = flag('host', '127.0.0.1');

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.cljs': 'text/javascript; charset=utf-8',
};

const deck = createDeckMiddleware({root});

const serveStatic = async (req, res) => {
  const {pathname} = new URL(req.url, 'http://localhost');
  const decoded = decodeURIComponent(pathname);
  const filePath = path.join(root, decoded);

  // Anything that escapes the deck's directory is not this deck's to serve.
  const relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const stats = await fsp.stat(filePath);
    if (stats.isDirectory()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404).end('Not found');
  }
};

const server = http.createServer((req, res) => {
  deck(req, res, err => {
    if (err) {
      console.error(err);
      res.writeHead(500).end(String(err));
      return;
    }
    serveStatic(req, res);
  });
});

server.listen(port, host, () => {
  console.log(`\n  Deck dev server\n`);
  console.log(`  Root:  ${root}`);
  console.log(`  Local: http://${host}:${port}/\n`);
});

const shutdown = () => {
  deck.close();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
