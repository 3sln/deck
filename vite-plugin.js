import fs from 'fs-extra';
import path from 'path';
import { globSync } from 'glob';

function getHtmlTemplate(title, importMap, cardPaths) {
    return `
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>${title}</title>
            ${importMap ? `<script type="importmap">${JSON.stringify(importMap)}</script>` : ''}
            <script>
              window.__INITIAL_CARD_PATHS__ = ${JSON.stringify(cardPaths)};
            </script>
            <style>
              :root { --bg-color: #fff; --text-color: #222; --border-color: #eee; --card-bg: #fff;
                --card-hover-bg: #f9f9f9; --input-bg: #fff; --input-border: #ddd; --link-color: #007aff;
              }
              @media (prefers-color-scheme: dark) {
                :root {
                  --bg-color: #121212; --text-color: #eee; --border-color: #333; --card-bg: #1e1e1e;
                  --card-hover-bg: #2a2a2a; --input-bg: #2a2a2a; --input-border: #444; --link-color: #09f;
                }
              }
              body {
                background-color: var(--bg-color); color: var(--text-color);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                margin: 0; padding: 0;
              }
            </style>
          </head>
          <body>
            <div id="root"></div>
            <script type="module">
              import { renderReel } from '@3sln/reel';
              renderReel({
                target: document.getElementById('root'),
                initialCardPaths: window.__INITIAL_CARD_PATHS__
              });
            </script>
          </body>
        </html>
    `;
}

export default function reelPlugin() {
  let resolvedConfig;

  function getCardPaths(options) {
    const { include, ignore } = options;
    return globSync(include, { 
        cwd: resolvedConfig.root,
        ignore: ignore,
        nodir: true,
        dot: true
    });
  }

  return {
    name: 'vite-plugin-reel',
    enforce: 'pre',

    resolveId(id) {
      const hmrRegex = /[?&]reel-dev-hmr\b/;
      if (hmrRegex.test(id)) {
        return '\0' + id;
      }
    },

    load(id) {
      const hmrRegex = /[?&]reel-dev-hmr\b/;
      if (id.startsWith('\0') && hmrRegex.test(id)) {
        console.log('here');
        const realPath = id.slice(1).replace(hmrRegex, '');
        return `
          import realDefault from '${realPath}';

          let lastArgs;
          let abortController = new AbortController();

          if (import.meta.hot?.data.lastArgs) {
            lastArgs = import.meta.hot.data.lastArgs;
          }

          export default (...args) => {
            lastArgs = args;
            const thisContext = { signal: abortController.signal };
            realDefault.call(thisContext, ...args);
          };

          if (import.meta.hot) {
            import.meta.hot.dispose(data => {
              data.lastArgs = lastArgs;
              abortController.abort();
            });

            import.meta.hot.accept(newModule => {
              if (newModule && newModule.default && lastArgs) {
                newModule.default(...lastArgs);
              }
            });
          }
        `;
      }
    },

    configResolved(config) {
        resolvedConfig = config;
    },

    async configureServer(server) {
      const userPkgJsonPath = path.resolve(resolvedConfig.root, 'package.json');
      const userPkgJson = await fs.readJson(userPkgJsonPath);
      const options = userPkgJson['@3sln/reel'] || {};

      const title = options.dev?.title || options.title || 'Reel (Dev)';
      const importMap = options.dev?.importMap || options.importMap;

      const defaultIgnore = [
          '**/node_modules/**', 
          'out/**',
          `**/${path.basename(resolvedConfig.build.outDir)}/**`,
          '**/package.json', 
          '**/package-lock.json',
          '**/vite.config.js',
          '**/.git/**'
      ];
      const include = options.dev?.include || ['**/*.{md,html}'];
      const ignore = options.dev?.exclude || defaultIgnore;

      server.watcher.on('all', (eventName, eventPath) => {
        if (!globSync(include, { ignore: ignore, cwd: resolvedConfig.root }).includes(eventPath)) return;

        const webPath = path.relative(resolvedConfig.root, eventPath).replace(/\\/g, '/');

        switch (eventName) {
            case 'add':
            case 'change':
                server.ws.send({ type: 'custom', event: 'reel:card-changed', data: { path: webPath } });
                break;
            case 'unlink':
                server.ws.send({ type: 'custom', event: 'reel:card-removed', data: { path: webPath } });
                break;
        }
      });

      server.middlewares.use(async (req, res, next) => {
        if (req.url.endsWith('/')) {
          const cardPaths = getCardPaths({ include, ignore });
          const template = getHtmlTemplate(title, importMap, cardPaths);
          const html = await server.transformIndexHtml(req.url, template);
          res.end(html);
          return;
        }
        next();
      });
    }
  };
}
