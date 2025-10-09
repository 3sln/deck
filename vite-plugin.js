import fs from 'fs-extra';
import path from 'path';
import {globSync} from 'glob';

const moduleUrl = import.meta.url;

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
    const {include, exclude} = options;
    const projPaths = globSync(include, {
      cwd: resolvedConfig.root,
      ignore: exclude,
      nodir: true,
      dot: true,
    });

    const webPaths = projPaths.map(projPath => '/' + projPath.replace(/\\/g, '/'));

    return webPaths;
  }

  return {
    name: 'vite-plugin-reel',

    resolveId(id) {
      if (id.startsWith('/@reel-dev-hmr/')) {
        return id;
      }
      return null;
    },

    async handleHotUpdate({read, modules, server}) {
      const rawUrls = modules.map(m => m.url).filter(u => u.endsWith('?raw'));
      if (rawUrls.length === 0) {
        return;
      }

      server.ws.send({
        type: 'custom',
        event: 'reel-raw-update',
        data: {urls: rawUrls, text: await read()}
      });
    },

    load(id) {
      if (id.startsWith('/@reel-dev-hmr/')) {
        const realPath = decodeURIComponent(id.slice('/@reel-dev-hmr/'.length));
        const rawPath = realPath + '?raw';
        return `
          import realDefault from '${realPath}';
          import moduleText from '${rawPath}';

          let lastArgs;
          let abortController = new AbortController();

          if (import.meta.hot?.data.lastArgs) {
            lastArgs = import.meta.hot.data.lastArgs;
          }

          const textObservers = import.meta.hot?.data.textObservers ?? [];
          export const moduleText$ = {
            subscribe: observer => {
              const observerObj = typeof observer === 'function' ? {next: observer} : observer;
              observerObj?.next(moduleText);
              textObservers.push(observerObj);

              return {
                unsubscribe: () => {
                  textObservers = textObservers.filter(x => x !== observerObj);
                }
              };
            }
          };

          export default (...args) => {
            lastArgs = args;
            const thisContext = { signal: abortController.signal };
            realDefault.call(thisContext, ...args);
          };

          if (import.meta.hot) {
            import.meta.hot.dispose(data => {
              data.lastArgs = lastArgs;
              data.textObservers = textObservers;
              abortController.abort();
            });

            import.meta.hot.accept(newModule => {
              if (newModule && newModule.default && lastArgs) {
                newModule.default(...lastArgs);
              }
            });
            import.meta.hot.on('reel-raw-update', ({urls, text}) => {
              if (!urls.includes('${rawPath}')) {
                return;
              }

              for (const observer of textObservers) {
                observer?.next(text);
              }
            });
          }
        `;
      }
      return null;
    },

    config(config, { command }) {
      return { optimizeDeps: { include: config.optimizeDeps?.include ?? []}}
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
        '**/.git/**',
      ];
      const include = options.dev?.include || ['**/*.{md,html}'];
      const exclude = options.dev?.exclude || defaultIgnore;

      server.watcher.on('all', (eventName, eventPath) => {
        const projPath = path.relative(resolvedConfig.root, eventPath);
        const webPath = '/' + projPath.replace(/\\/g, '/');
        if (!getCardPaths({include, exclude}).includes(webPath)) return;

        switch (eventName) {
          case 'add':
          case 'change':
            server.ws.send({type: 'custom', event: 'reel:card-changed', data: {path: webPath}});
            break;
          case 'unlink':
            server.ws.send({type: 'custom', event: 'reel:card-removed', data: {path: webPath}});
            break;
        }
      });

      server.middlewares.use(async (req, res, next) => {
        if (req.url.endsWith('/')) {
          const cardPaths = getCardPaths({include, exclude});
          const template = getHtmlTemplate(title, importMap, cardPaths);
          const html = await server.transformIndexHtml(req.url, template);
          res.end(html);
          return;
        }
        next();
      });
    },
  };
}
